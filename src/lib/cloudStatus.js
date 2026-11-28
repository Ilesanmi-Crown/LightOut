// Shared "Google's AI is busy — retrying (n/3)…" status for progress areas.
import { useEffect, useState } from "react";

const active = new Map(); // callId -> { kind: "retry" | "fallback", attempt, max, model, task, at }
const listeners = new Set();

function latest() {
  let best = null;
  for (const s of active.values()) if (!best || s.at > best.at) best = s;
  return best;
}
const emit = () => {
  const s = latest();
  listeners.forEach((fn) => fn(s));
};

export function setCloudStatus(callId, status) {
  if (status) active.set(callId, { ...status, at: Date.now() });
  else active.delete(callId);
  emit();
}

export function useCloudStatus() {
  const [s, setS] = useState(latest);
  useEffect(() => {
    listeners.add(setS);
    return () => listeners.delete(setS);
  }, []);
  return s;
}

export function cloudStatusText(s) {
  if (!s) return "";
  if (s.kind === "fallback") return `Google's AI is busy — trying a backup model (${s.model})…`;
  return `Google's AI is busy — retrying (${s.attempt}/${s.max})…`;
}
