// Prepared-file cache: a file whose contents were prepared before is never prepared again.
// Keyed by SHA-256 of the file bytes; capped at ~50 MB with least-recently-used eviction.
import { local } from "./db.js";

export const FILE_CACHE_MAX_BYTES = 50 * 1024 * 1024;

const entryBytes = (payload) =>
  payload?.text ? new TextEncoder().encode(payload.text).length : payload?.inlineData?.data?.length || 0;

export async function getPreparedFile(hash) {
  try {
    const hit = await local.files.get(hash);
    if (!hit) return null;
    local.files.update(hash, { lastUsed: Date.now() }).catch(() => {});
    return hit;
  } catch {
    return null;
  }
}

export async function putPreparedFile(hash, { kind, payload, payloadBytes }) {
  try {
    const bytes = entryBytes(payload);
    if (bytes > FILE_CACHE_MAX_BYTES) return;
    await local.files.put({ hash, kind, payload, payloadBytes, bytes, lastUsed: Date.now() });
    await evict();
  } catch (e) {
    console.warn("[Lightout] Couldn't cache prepared file", e);
  }
}

async function evict() {
  const rows = await local.files.orderBy("lastUsed").toArray(); // oldest first
  let total = rows.reduce((n, r) => n + (r.bytes || 0), 0);
  const drop = [];
  for (const r of rows) {
    if (total <= FILE_CACHE_MAX_BYTES) break;
    drop.push(r.hash);
    total -= r.bytes || 0;
  }
  if (drop.length) await local.files.bulkDelete(drop);
}
