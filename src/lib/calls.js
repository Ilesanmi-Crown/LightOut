// Every AI call (on-device or cloud) is logged in IndexedDB for the device-vs-cloud benchmark.
import { local } from "./db.js";

const MAX_ROWS = 1000;
const listeners = new Set();

export function onCallsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function recordCall(row) {
  try {
    await local.calls.add({ at: Date.now(), ...row });
    const count = await local.calls.count();
    if (count > MAX_ROWS) {
      const old = await local.calls.orderBy("id").limit(count - MAX_ROWS).primaryKeys();
      await local.calls.bulkDelete(old);
    }
    listeners.forEach((fn) => fn());
  } catch (e) {
    console.warn("[Lightout] Couldn't log AI call", e);
  }
}

function summarise(rows) {
  if (!rows.length) return { calls: 0, avgMs: null, avgBytes: null, totalBytes: 0 };
  const totalMs = rows.reduce((n, r) => n + (r.ms || 0), 0);
  const totalBytes = rows.reduce((n, r) => n + (r.requestBytes || 0) + (r.responseBytes || 0), 0);
  return { calls: rows.length, avgMs: totalMs / rows.length, avgBytes: totalBytes / rows.length, totalBytes };
}

/** { device: {calls, avgMs, avgBytes, totalBytes}, cloud: {...} } */
export async function getCallStats() {
  const rows = await local.calls.toArray();
  return {
    device: summarise(rows.filter((r) => r.source === "device")),
    cloud: summarise(rows.filter((r) => r.source === "cloud")),
  };
}

export async function clearCalls() {
  await local.calls.clear();
  listeners.forEach((fn) => fn());
}
