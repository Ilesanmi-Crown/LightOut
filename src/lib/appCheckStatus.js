// Fetch an App Check token on load while online, so a valid token is cached before the network drops.
// Note: Firebase AI Logic only attaches App Check tokens to CLOUD requests. On-device (ONLY_ON_DEVICE)
// calls never fetch a token, so App Check can't block offline answers; this prefetch is for the next
// cloud call (e.g. right after reconnecting).
import { getToken } from "firebase/app-check";
import { appCheck } from "../firebase.js";
import { formatRawError } from "./diagnostics.js";

let state = { status: "idle" }; // idle | fetching | ok | error | off
const listeners = new Set();
const set = (s) => {
  state = s;
  listeners.forEach((fn) => fn(state));
};

export function getAppCheckPrefetch() {
  return state;
}
export function onAppCheckPrefetch(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function prefetchAppCheckToken() {
  if (!appCheck) return set({ status: "off" });
  if (!navigator.onLine || state.status === "fetching") return state;
  set({ status: "fetching" });
  const start = performance.now();
  try {
    const res = await Promise.race([
      getToken(appCheck, false),
      new Promise((_, rej) => setTimeout(() => rej(new Error("getToken did not settle within 15s")), 15_000)),
    ]);
    set({ status: "ok", at: new Date().toISOString(), length: res.token?.length || 0, ms: Math.round(performance.now() - start) });
  } catch (e) {
    set({ status: "error", at: new Date().toISOString(), error: formatRawError(e) });
  }
  return state;
}
