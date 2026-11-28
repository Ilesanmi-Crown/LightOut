// SHA-256 helpers (crypto.subtle runs natively, off the JS thread).
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

export async function hashFile(file) {
  return sha256(await file.arrayBuffer());
}
