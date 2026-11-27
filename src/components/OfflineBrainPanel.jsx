import { useState } from "react";
import { downloadOfflineBrain } from "../ai.js";

/** Onboarding: download Gemini Nano while there's Wi-Fi. Hidden once ready or unsupported. */
export default function OfflineBrainPanel({ status, online, onRefresh }) {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  if (status === "available" || status === "checking" || status === "unsupported") return null;

  const pct = progress === null ? 0 : Math.round(progress * 100);
  const canDownload = online && (status === "downloadable" || status === "downloading") && progress === null;

  async function handleDownload() {
    setError("");
    setProgress(0);
    try {
      await downloadOfflineBrain((p) => setProgress(p));
      setProgress(1);
    } catch (e) {
      setError(`Couldn't download the offline brain: ${e?.message || e}`);
    } finally {
      await onRefresh();
      setTimeout(() => setProgress(null), 1200);
    }
  }

  return (
    <section className={`panel onboarding ${status === "unavailable" ? "is-unsupported" : ""}`}>
      {status === "unavailable" ? (
        <div className="onb-grid">
          <div className="onb-num">⌁</div>
          <div>
            <h2>Cloud mode on this device</h2>
            <p>
              This device can't run the offline brain (Gemini Nano needs Chrome desktop v139+ on hardware that meets its
              requirements). Everything still works through the cloud while you're online.
            </p>
          </div>
        </div>
      ) : (
        <div className="onb-grid">
          <div className="onb-num" aria-hidden="true">
            {String(pct).padStart(2, "0")}
            <small>%</small>
          </div>
          <div>
            <h2>Charge up before the next outage.</h2>
            <p>
              Download the offline brain (Gemini Nano, a one-time download of a few GB) while you have Wi-Fi. After that,
              marking, answers and quick tools work with zero data.
            </p>
            <button className="cta" onClick={handleDownload} disabled={!canDownload}>
              <span>{progress !== null ? "Downloading…" : "Download the offline brain"}</span>
              <span className="arrow" aria-hidden="true">↓</span>
            </button>
            {!online && <p className="hint">You need to be online to download it.</p>}
            {progress !== null && (
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <div className="bar" style={{ width: `${pct}%` }} />
              </div>
            )}
            {error && (
              <p className="error" role="alert">
                <span aria-hidden="true">!</span>
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
