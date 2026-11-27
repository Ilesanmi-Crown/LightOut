import { useCallback, useEffect, useState } from "react";
import { startDownload, useDownload } from "../lib/download.js";
import { testOfflineBrain, runBenchmark } from "../lib/brain.js";
import { getCallStats, onCallsChange } from "../lib/calls.js";
import { getSavings, onSavingsChange } from "../lib/savings.js";
import { getConfig, onConfigChange } from "../lib/config.js";
import { formatRawError } from "../lib/diagnostics.js";
import { formatKB, formatMB, formatNaira, formatSecsShort } from "../lib/format.js";

function stateFor(status, progress) {
  if (progress !== null || status === "downloading")
    return {
      key: "downloading",
      icon: "⬇️",
      title: progress !== null ? `Downloading… ${Math.round(progress * 100)}%` : "Downloading…",
      line: "Chrome is downloading Gemini Nano. Keep this tab open and stay on Wi-Fi.",
    };
  if (status === "available")
    return { key: "ready", icon: "✅", title: "Ready for blackout", line: "Marking, answers and quick tools run on this device with no data." };
  if (status === "downloadable")
    return { key: "todo", icon: "☁️", title: "Not downloaded yet", line: "Download it once on Wi-Fi (a few GB) and it works offline from then on." };
  if (status === "unavailable" || status === "unsupported")
    return {
      key: "unsupported",
      icon: "⚠️",
      title: "Not supported on this browser",
      line: "Offline AI needs Chrome on desktop (v139+). The app still works online via the cloud.",
    };
  return { key: "checking", icon: "…", title: "Checking…", line: "Asking Chrome whether the on-device model is available." };
}

/** Offline Brain: model manager, self-test, storage, and the device-vs-cloud benchmark. */
export default function OfflineBrain({ status, online, onRefresh }) {
  const { progress, error: downloadError } = useDownload();
  const [test, setTest] = useState({ state: "idle" });
  const [bench, setBench] = useState({ state: "idle" });
  const [stats, setStats] = useState(null);
  const [savings, setSavings] = useState(null);
  const [rate, setRate] = useState(getConfig().naira_per_mb);
  const [storage, setStorage] = useState(undefined);

  const loadStats = useCallback(() => getCallStats().then(setStats), []);

  useEffect(() => {
    loadStats();
    getSavings().then(setSavings);
    const offCalls = onCallsChange(loadStats);
    const offSavings = onSavingsChange(setSavings);
    const offConfig = onConfigChange((c) => setRate(c.naira_per_mb));
    (async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        setStorage(est ? est.usage ?? null : null);
      } catch {
        setStorage(null);
      }
    })();
    return () => {
      offCalls();
      offSavings();
      offConfig();
    };
  }, [loadStats]);

  const st = stateFor(status, progress);
  const pct = progress === null ? 0 : Math.round(progress * 100);
  const supported = status !== "unsupported" && status !== "unavailable" && status !== "checking";
  const canDownload = online && (status === "downloadable" || status === "downloading") && progress === null;
  const benchReason = !online
    ? "Connect to the internet to compare with the cloud."
    : status !== "available"
      ? st.key === "unsupported"
        ? "On-device AI isn't supported on this browser, so there's nothing to compare."
        : "Download the offline brain first."
      : "";

  async function handleTest() {
    setTest({ state: "running" });
    const r = await testOfflineBrain();
    setTest({ state: r.pass ? "pass" : "fail", ...r });
    onRefresh();
  }

  async function handleBench() {
    setBench({ state: "running" });
    const r = await runBenchmark();
    setBench({ state: "done", ...r });
  }

  const savedBytes = savings?.bytesSaved || 0;
  const savedNaira = (savedBytes / (1024 * 1024)) * rate;

  return (
    <>
      <div className="screen-head">
        <h2>Offline brain</h2>
        <p>Gemini Nano runs inside Chrome on this laptop, so studying keeps working when the light and data are gone.</p>
      </div>

      <section className={`panel brain-status is-${st.key}`}>
        <div className="brain-state">
          <span className="brain-icon" aria-hidden="true">
            {st.icon}
          </span>
          <div>
            <h3>{st.title}</h3>
            <p>{st.line}</p>
          </div>
        </div>

        {supported && status !== "available" && (
          <div className="brain-download">
            <button className="cta" onClick={() => startDownload(onRefresh)} disabled={!canDownload}>
              <span>{progress !== null ? "Downloading…" : "Download offline brain"}</span>
              <span className="arrow" aria-hidden="true">↓</span>
            </button>
            {!online && <p className="offline-note">Connect once to download.</p>}
          </div>
        )}
        {(progress !== null || status === "downloading") && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="bar" style={{ width: `${progress === null ? 4 : pct}%` }} />
          </div>
        )}
        {downloadError && (
          <p className="error" role="alert">
            <span aria-hidden="true">!</span>
            {downloadError}
          </p>
        )}

        <div className="brain-test">
          <button className="ghost" onClick={handleTest} disabled={test.state === "running" || !supported}>
            {test.state === "running" ? "Testing…" : "Test offline brain"}
          </button>
          {test.state === "pass" && (
            <span className="ok-text">
              ✓ Pass: replied “{test.text}” on device in {formatSecsShort(test.ms)}
            </span>
          )}
          {test.state === "fail" && (
            <span className="warn-text">✗ Fail{test.reason ? `: ${test.reason}` : test.text ? `: unexpected reply “${test.text}”` : ""}</span>
          )}
          {!supported && status !== "checking" && <span className="hint inline">Needs Chrome on desktop (v139+).</span>}
        </div>
        {test.state === "fail" && test.error && <pre className="debug-pre bad">{formatRawError(test.error)}</pre>}
      </section>

      <section className="panel compare" aria-label="On device vs cloud">
        <div className="compare-head">
          <h3>On device vs cloud</h3>
          <span className="sec-n">From every AI call on this device</span>
        </div>
        <div className="compare-grid">
          <CompareSide
            kind="device"
            label="🔒 On device"
            avgMs={stats?.device.avgMs}
            data="0 KB data"
            calls={stats?.device.calls}
          />
          <CompareSide
            kind="cloud"
            label="☁️ Cloud"
            avgMs={stats?.cloud.avgMs}
            data={stats?.cloud.calls ? `~${formatKB(stats.cloud.avgBytes)} per call` : "– per call"}
            calls={stats?.cloud.calls}
          />
        </div>
        <p className="compare-saved">
          Data saved by on-device AI: <b>{formatMB(savedBytes)} MB</b> <span>(≈ {formatNaira(savedNaira)} at ₦{rate}/MB)</span>
        </p>

        <div className="bench">
          <div className="bench-row">
            <button className="cta small" onClick={handleBench} disabled={!!benchReason || bench.state === "running"}>
              <span>{bench.state === "running" ? "Running…" : "Run benchmark"}</span>
              <span className="arrow" aria-hidden="true">
                {bench.state === "running" ? <span className="btn-spinner" /> : "⏱"}
              </span>
            </button>
            <span className="hint inline">{benchReason || "Same short summary, once on device, once in the cloud."}</span>
          </div>
          {bench.state === "done" && (
            <div className="bench-result">
              <BenchSide kind="device" label="🔒 On device" r={bench.device} />
              <BenchSide kind="cloud" label="☁️ Cloud" r={bench.cloud} />
            </div>
          )}
        </div>
      </section>

      <section className="panel storage">
        <h3>Storage</h3>
        <p className="storage-big">
          Lightout data on this device:{" "}
          <b>{storage === undefined ? "…" : storage === null ? "unknown" : `${formatMB(storage)} MB`}</b>
        </p>
        <p className="hint">
          Packs, progress and the offline app shell. The AI model itself is managed by Chrome and isn&apos;t counted here (see
          chrome://on-device-internals).
        </p>
      </section>
    </>
  );
}

function CompareSide({ kind, label, avgMs, data, calls }) {
  return (
    <div className={`compare-side ${kind}`}>
      <span className="compare-label">{label}</span>
      <b className="compare-time">{avgMs == null ? "–" : `avg ${formatSecsShort(avgMs)}`}</b>
      <span>{data}</span>
      <span>
        {calls ?? 0} call{calls === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function BenchSide({ kind, label, r }) {
  return (
    <div className={`bench-side ${kind}`}>
      <span className="compare-label">{label}</span>
      {r?.error ? (
        <pre className="debug-pre bad">{formatRawError(r.error)}</pre>
      ) : (
        <>
          <b className="compare-time">{formatSecsShort(r?.ms)}</b>
          <span>{kind === "device" ? "0 KB data" : `~${formatKB(r?.bytes)} data`}</span>
        </>
      )}
    </div>
  );
}
