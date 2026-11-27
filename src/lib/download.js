// Shared download state for the offline brain, so the header chip, the onboarding
// panel and the Offline Brain screen all show the same progress.
import { useEffect, useState } from "react";
import { downloadOfflineBrain } from "../ai.js";
import { formatRawError } from "./diagnostics.js";

let state = { progress: null, error: null }; // progress: null | 0..1
const listeners = new Set();

function set(next) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn(state));
}

/** Must be called from a user gesture (button click). */
export async function startDownload(onDone) {
  if (state.progress !== null) return;
  set({ progress: 0, error: null });
  try {
    await downloadOfflineBrain((p) => set({ progress: p }));
    set({ progress: 1 });
  } catch (e) {
    set({ error: { text: "Download didn't finish. Check your Wi-Fi and try again.", details: formatRawError(e) } });
  } finally {
    await onDone?.();
    setTimeout(() => set({ progress: null }), 1200);
  }
}

export function useDownload() {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    return () => listeners.delete(setS);
  }, []);
  return s;
}
