// Raw error reporting + the last AI error, for the ?debug=1 panel.

/** Plain object with everything useful from an AIError / FirebaseError / Error. */
export function errorDetails(err) {
  if (err == null) return null;
  if (typeof err !== "object") return { message: String(err) };
  const out = {
    name: err.name,
    code: err.code,
    message: err.message,
  };
  const ced = err.customErrorData;
  if (ced) {
    out.customErrorData = {
      status: ced.status,
      statusText: ced.statusText,
      errorDetails: ced.errorDetails,
    };
  }
  if (err.customData && typeof err.customData === "object") out.customData = err.customData;
  if (err.cause) out.cause = String(err.cause?.message || err.cause);
  return out;
}

/** Multi-line, human-readable raw error: name, code, message, then status/statusText/errorDetails. */
export function formatRawError(err) {
  const d = errorDetails(err);
  if (!d) return "Unknown error";
  const lines = [`${d.name || "Error"}${d.code ? ` [${d.code}]` : ""}: ${d.message || "(no message)"}`];
  if (d.customErrorData) {
    const { status, statusText, errorDetails: details } = d.customErrorData;
    if (status != null || statusText) lines.push(`HTTP ${status ?? "?"} ${statusText || ""}`.trim());
    if (details != null) lines.push(`errorDetails: ${safeJson(details)}`);
  }
  if (d.customData) lines.push(`customData: ${safeJson(d.customData)}`);
  if (d.cause) lines.push(`cause: ${d.cause}`);
  return lines.join("\n");
}

export function safeJson(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// ---------- last AI error ----------
let lastAIError = null;
const listeners = new Set();

export function setLastAIError(err, context) {
  lastAIError = err ? { at: new Date().toISOString(), context, details: errorDetails(err), text: formatRawError(err) } : null;
  listeners.forEach((fn) => fn(lastAIError));
}

export function getLastAIError() {
  return lastAIError;
}

export function onLastAIError(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isDebug() {
  try {
    return new URLSearchParams(window.location.search).get("debug") === "1";
  } catch {
    return false;
  }
}
