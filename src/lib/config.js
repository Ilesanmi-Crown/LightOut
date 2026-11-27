// Remote Config with in-app defaults. Offline, the SDK serves the last activated
// (cached) values, or these defaults on first run.
import { fetchAndActivate, getNumber, getString } from "firebase/remote-config";
import { remoteConfig } from "../firebase.js";

export const CONFIG_DEFAULTS = {
  cloud_model_name: import.meta.env.VITE_CLOUD_MODEL || "gemini-3.8-flash",
  // Rough Nigerian mobile-data price: ~₦1,000 per GB. Tune it in Remote Config.
  naira_per_mb: 1,
  pack_question_count: 30,
};

remoteConfig.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 60_000 : 60 * 60 * 1000;
remoteConfig.settings.fetchTimeoutMillis = 8_000;
remoteConfig.defaultConfig = CONFIG_DEFAULTS;

function read() {
  try {
    return {
      cloud_model_name: getString(remoteConfig, "cloud_model_name") || CONFIG_DEFAULTS.cloud_model_name,
      naira_per_mb: getNumber(remoteConfig, "naira_per_mb") || CONFIG_DEFAULTS.naira_per_mb,
      pack_question_count: Math.max(10, Math.min(60, getNumber(remoteConfig, "pack_question_count") || CONFIG_DEFAULTS.pack_question_count)),
    };
  } catch {
    return { ...CONFIG_DEFAULTS };
  }
}

let current = read();
const listeners = new Set();

export function getConfig() {
  return current;
}

export function onConfigChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Fetch + activate when online; never throws. */
export async function refreshConfig() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return current;
  try {
    await fetchAndActivate(remoteConfig);
  } catch (e) {
    console.warn("[Lightout] Remote Config fetch failed; using cached/default values.", e?.message || e);
  }
  current = read();
  listeners.forEach((fn) => fn(current));
  return current;
}
