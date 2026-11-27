import { InferenceSource } from "../ai.js";

export function formatSecs(ms) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** "🔒 On device · 1.2s" / "☁️ Cloud · 2.8s" / "Generating…" */
export function SourceBadge({ source, ms, streaming }) {
  if (streaming)
    return (
      <span className="badge streaming">
        <span className="dot" /> Generating…
      </span>
    );
  const time = ms != null ? ` · ${formatSecs(ms)}` : "";
  if (source === InferenceSource.ON_DEVICE)
    return (
      <span className="badge device" title="Ran on your device with Gemini Nano">
        🔒 On device{time}
      </span>
    );
  if (source === InferenceSource.IN_CLOUD)
    return (
      <span className="badge cloud" title="Ran in the cloud with Gemini">
        ☁️ Cloud{time}
      </span>
    );
  return ms != null ? <span className="badge">⏱ {formatSecs(ms)}</span> : null;
}

export function PrivacyLine({ source }) {
  if (source !== InferenceSource.ON_DEVICE) return null;
  return <p className="privacy">🔒 Your notes never left this device.</p>;
}
