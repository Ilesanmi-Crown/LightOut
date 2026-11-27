// Running totals of what on-device AI saved, stored in IndexedDB.
import { local } from "./db.js";

const KEY = "savings";
const EMPTY = { key: KEY, onDeviceCalls: 0, bytesSaved: 0, offlineAnswers: 0 };
const listeners = new Set();

export async function getSavings() {
  try {
    return { ...EMPTY, ...((await local.meta.get(KEY)) || {}) };
  } catch {
    return { ...EMPTY };
  }
}

export function onSavingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function update(fn) {
  const next = await local.transaction("rw", local.meta, async () => {
    const cur = { ...EMPTY, ...((await local.meta.get(KEY)) || {}) };
    const n = fn(cur);
    await local.meta.put(n);
    return n;
  });
  listeners.forEach((l) => l(next));
  return next;
}

/** One on-device AI call: bytes that would otherwise have gone over mobile data. */
export function addSavings({ requestBytes = 0, responseBytes = 0 }) {
  return update((s) => ({ ...s, onDeviceCalls: s.onDeviceCalls + 1, bytesSaved: s.bytesSaved + requestBytes + responseBytes }));
}

/** A pack question answered while offline (MCQ or short answer). */
export function addOfflineAnswer() {
  return update((s) => ({ ...s, offlineAnswers: s.offlineAnswers + 1 }));
}

export function resetSavings() {
  return update(() => ({ ...EMPTY }));
}
