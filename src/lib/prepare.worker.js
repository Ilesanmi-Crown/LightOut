// Off-main-thread preparation for PDFs and photos.
// In:  { file: File, kind: "pdf" | "image", maxSide, quality, passThroughBytes }
// Out: { ok: true, mimeType, base64, payloadBytes, converted } | { ok: false, error, decode }

function dataUrlToBase64(dataUrl) {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

function readBase64(blob) {
  // FileReaderSync is available in workers and doesn't block the page.
  return dataUrlToBase64(new FileReaderSync().readAsDataURL(blob));
}

async function prepareImage(file, { maxSide, quality, passThroughBytes }) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, decode: true, error: "decode" };
  }
  const { width, height } = bitmap;
  const isJpegOrPng = file.type === "image/jpeg" || file.type === "image/png";
  // Small JPEG/PNG photos are already fine for the cloud: send the original bytes.
  if (isJpegOrPng && Math.max(width, height) <= maxSide && file.size <= passThroughBytes) {
    bitmap.close();
    return { ok: true, mimeType: file.type, base64: readBase64(file), payloadBytes: file.size, converted: false };
  }
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent PNGs become white, not black
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  return { ok: true, mimeType: "image/jpeg", base64: readBase64(blob), payloadBytes: blob.size, converted: true };
}

self.onmessage = async (e) => {
  const { file, kind } = e.data;
  try {
    if (kind === "pdf") {
      self.postMessage({ ok: true, mimeType: "application/pdf", base64: readBase64(file), payloadBytes: file.size, converted: false });
    } else {
      self.postMessage(await prepareImage(file, e.data));
    }
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.message || err) });
  }
};
