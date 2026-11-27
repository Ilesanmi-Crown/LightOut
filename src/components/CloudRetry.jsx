import { useState } from "react";
import { InferenceSource } from "../ai.js";
import { SourceBadge } from "./AIMeta.jsx";
import { formatRawError } from "../lib/diagnostics.js";

/**
 * Wraps an on-device result. When online, offers "Retry in cloud": re-runs the exact same
 * request with ONLY_IN_CLOUD (only on tap, never automatically) and shows the cloud answer
 * below, with the on-device answer kept above in a collapsible block for comparison.
 *
 * onRetry(onText) => Promise<{ data, source, ms }>
 * renderData(data, { streaming }) renders the cloud answer the same way as the device one.
 */
export default function CloudRetry({ source, online, onRetry, renderData, deviceSummary, children }) {
  const [cloud, setCloud] = useState(null); // { state, data, source, ms, error }
  const isDevice = source === InferenceSource.ON_DEVICE;
  if (!isDevice) return children;

  async function retry() {
    setCloud({ state: "running", data: null });
    try {
      const r = await onRetry((partial) => setCloud({ state: "running", data: partial, streaming: true }));
      setCloud({ state: "done", ...r });
    } catch (e) {
      console.error(e);
      setCloud({ state: "error", error: e });
    }
  }

  if (!cloud) {
    return (
      <>
        {children}
        {online && (
          <div className="retry-row">
            <button type="button" className="retry-btn" onClick={retry}>
              ☁️ Retry in cloud
            </button>
            <span className="hint inline">Compare with Gemini in the cloud (uses data).</span>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <details className="device-answer" open>
        <summary>
          <span>🔒 On-device answer</span>
          {deviceSummary}
        </summary>
        <div className="device-answer-body">{children}</div>
      </details>
      <div className="cloud-answer" aria-live="polite">
        <div className="cloud-answer-head">
          <span>Cloud answer</span>
          {cloud.state === "running" ? (
            <SourceBadge streaming />
          ) : cloud.state === "done" ? (
            <SourceBadge source={cloud.source ?? InferenceSource.IN_CLOUD} ms={cloud.ms} />
          ) : null}
        </div>
        {cloud.state === "error" ? (
          <p className="error" role="alert">
            <span aria-hidden="true">!</span>
            {formatRawError(cloud.error)}
          </p>
        ) : cloud.data != null ? (
          renderData(cloud.data, { streaming: cloud.state === "running" })
        ) : (
          <p className="hint">
            <span className="btn-spinner" aria-hidden="true" /> Asking Gemini in the cloud…
          </p>
        )}
        {(cloud.state === "error" || cloud.state === "done") && online && (
          <button type="button" className="retry-btn subtle" onClick={retry}>
            ↻ Retry in cloud again
          </button>
        )}
      </div>
    </>
  );
}
