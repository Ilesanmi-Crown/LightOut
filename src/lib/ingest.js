// Turns user uploads into Firebase AI Logic parts.
// - DOCX -> text (mammoth, client-side), TXT -> text
// - PDF -> inlineData (cloud only: on-device can't read PDFs)
// - JPEG/PNG/WebP/HEIC photos -> re-encoded JPEG via canvas (max 1600px, q=0.8) -> inlineData
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.8;

const EXT_KIND = {
  pdf: "pdf",
  docx: "docx",
  txt: "txt",
  md: "txt",
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  heic: "image",
  heif: "image",
};

export const ACCEPT = ".pdf,.docx,.txt,.md,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*,text/plain";

export function detectKind(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("text/")) return "txt";
  return EXT_KIND[ext] || null;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function readAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("Couldn't read the file."));
    r.readAsDataURL(blob);
  });
}

async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img> (Safari decodes HEIC this way) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode"));
      img.src = url;
    });
  } finally {
    // Safe: the decoded image keeps its pixels after the URL is revoked.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

async function imageToJpeg(file) {
  let img;
  try {
    img = await decodeImage(file);
  } catch {
    const heic = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type);
    throw new Error(
      heic
        ? `Can't open "${file.name}" here. Send it as a JPEG instead.`
        : `Couldn't open "${file.name}". Try another photo.`
    );
  }
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent PNGs become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return { mimeType: "image/jpeg", base64, payloadBytes: Math.floor((base64.length * 3) / 4), previewUrl: dataUrl };
}

const PASS_THROUGH_BYTES = 1.5 * 1024 * 1024; // small JPEG/PNG photos are sent as-is

class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}
export const isCancelled = (e) => e?.name === "CancelledError";

const canUseWorker =
  typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined";

/** Runs one PDF/photo job in its own worker; terminating the worker cancels it. Resolves null if unsupported. */
function runInWorker(file, kind, signal) {
  if (!canUseWorker) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL("./prepare.worker.js", import.meta.url), { type: "module" });
    } catch {
      resolve(null);
      return;
    }
    const stop = () => {
      worker.terminate();
      reject(new CancelledError());
    };
    if (signal?.aborted) return stop();
    signal?.addEventListener("abort", stop, { once: true });
    worker.onmessage = (e) => {
      signal?.removeEventListener("abort", stop);
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = () => {
      signal?.removeEventListener("abort", stop);
      worker.terminate();
      resolve(null); // fall back to the main thread
    };
    worker.postMessage({ file, kind, maxSide: MAX_SIDE, quality: JPEG_QUALITY, passThroughBytes: PASS_THROUGH_BYTES });
  });
}

function heicError(file) {
  const heic = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type);
  return new Error(heic ? `Can't open "${file.name}" here. Send it as a JPEG instead.` : `Couldn't open "${file.name}". Try another photo.`);
}

/**
 * Prepares one file into its final cloud payload. Heavy work (PDF base64, photo
 * decode/resize/JPEG) runs in a worker where the browser supports it.
 * @returns {Promise<{ kind, payload: { text } | { inlineData: { data, mimeType } }, payloadBytes, previewUrl? }>}
 */
export async function prepareFile(file, { signal } = {}) {
  const kind = detectKind(file);
  if (!kind) throw new Error(`"${file.name}" isn't supported. Use a PDF, Word file, text file or photo.`);
  const check = () => {
    if (signal?.aborted) throw new CancelledError();
  };

  if (kind === "txt") {
    const text = await file.text();
    check();
    return { kind, payload: { text }, payloadBytes: new TextEncoder().encode(text).length };
  }
  if (kind === "docx") {
    const mammoth = await import("mammoth"); // lazy: only loaded when a Word file is added
    check();
    const { value } = await (mammoth.extractRawText || mammoth.default.extractRawText)({ arrayBuffer: await file.arrayBuffer() });
    check();
    const text = value.trim();
    if (!text) throw new Error(`"${file.name}" has no text we can read.`);
    return { kind, payload: { text }, payloadBytes: new TextEncoder().encode(text).length };
  }

  // PDF and photos: worker first, main thread as fallback.
  const w = await runInWorker(file, kind, signal);
  check();
  let res = w;
  if (!res || (!res.ok && !res.decode)) {
    if (kind === "pdf") {
      const dataUrl = await readAsDataURL(file);
      res = { ok: true, mimeType: "application/pdf", base64: dataUrl.slice(dataUrl.indexOf(",") + 1), payloadBytes: file.size };
    } else {
      try {
        res = { ok: true, ...(await imageToJpeg(file)) }; // main-thread canvas path (e.g. Safari HEIC)
      } catch (e) {
        throw e?.message ? e : heicError(file);
      }
    }
  } else if (!res.ok && res.decode) {
    // The worker couldn't decode it (often HEIC outside Safari); <img> on the main thread sometimes can.
    try {
      res = { ok: true, ...(await imageToJpeg(file)) };
    } catch {
      throw heicError(file);
    }
  }
  check();
  return {
    kind,
    payload: { inlineData: { data: res.base64, mimeType: res.mimeType } },
    payloadBytes: res.payloadBytes,
    previewUrl: kind === "image" ? `data:${res.mimeType};base64,${res.base64}` : undefined,
  };
}
