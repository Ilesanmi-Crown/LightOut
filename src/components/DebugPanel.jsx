import { useCallback, useEffect, useState } from "react";
import { getToken } from "firebase/app-check";
import { app, appCheck, appCheckDebugMode, APP_CHECK_PROVIDER, RECAPTCHA_ENTERPRISE_SITE_KEY } from "../firebase.js";
import { errorDetails, formatRawError, getLastAIError, onLastAIError, safeJson } from "../lib/diagnostics.js";
import { getConfig } from "../lib/config.js";
import { runPrompt, InferenceMode, InferenceSource, getOnDeviceStatus } from "../ai.js";
import { getAppCheckPrefetch, onAppCheckPrefetch } from "../lib/appCheckStatus.js";
import { askPack } from "../lib/ask.js";
import { validatePack } from "../lib/packs.js";
import samplePackFile from "../samplePack.json";
import { getLastBuildTimings, onBuildTimings } from "../lib/packBuilder.js";

const QA_TEST_QUESTION = "Why do governments tax fuel?";

const TOKEN_TIMEOUT_MS = 15_000;

/** Shown only with ?debug=1. Everything here is safe to screenshot: no secrets, site key truncated. */
export default function DebugPanel({ online }) {
  const [token, setToken] = useState({ state: "idle" });
  const [lastError, setLastError] = useState(getLastAIError);
  const [cloudTest, setCloudTest] = useState({ state: "idle" });
  const [prefetch, setPrefetch] = useState(getAppCheckPrefetch);
  const [qaTest, setQaTest] = useState({ state: "idle" });
  useEffect(() => onAppCheckPrefetch(setPrefetch), []);
  const [buildTimings, setBuildTimings] = useState(null);
  useEffect(() => {
    getLastBuildTimings().then(setBuildTimings);
    return onBuildTimings(setBuildTimings);
  }, []);

  async function runQaTest() {
    setQaTest({ state: "running" });
    const status = await getOnDeviceStatus({ refresh: true });
    if (status !== "available") {
      setQaTest({ state: "fail", text: `Offline brain is "${status}", so ONLY_ON_DEVICE can't run.` });
      return;
    }
    try {
      const pack = validatePack(samplePackFile.pack);
      const r = await askPack({
        pack,
        question: QA_TEST_QUESTION,
        history: [],
        mode: InferenceMode.ONLY_ON_DEVICE,
        bypassCache: true,
        label: "qa-self-test",
        countSavings: false,
      });
      const pass = r.source === InferenceSource.ON_DEVICE && r.text.trim().length > 0;
      setQaTest({
        state: pass ? "pass" : "fail",
        text: `${pass ? "Pass" : "Fail"} · ${r.source} · ${Math.round(r.ms)}ms · prompt ${r.chars} chars\nSections: ${r.sections.map((s) => s.title).join(" · ")}\nAnswer: ${r.text.trim().slice(0, 240)}`,
      });
    } catch (e) {
      setQaTest({ state: "fail", text: formatRawError(e) });
    }
  }

  const checkToken = useCallback(async () => {
    if (!appCheck) {
      setToken({ state: "error", text: "App Check was NOT initialized: VITE_RECAPTCHA_ENTERPRISE_SITE_KEY was empty when this build was made." });
      return;
    }
    setToken({ state: "running" });
    const start = performance.now();
    try {
      const res = await Promise.race([
        getToken(appCheck, /* forceRefresh */ false),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                Object.assign(new Error(`getToken did not settle within ${TOKEN_TIMEOUT_MS / 1000}s. The reCAPTCHA Enterprise script (www.google.com/recaptcha/enterprise.js) may be blocked (ad blocker, network) or slow.`), {
                  name: "TimeoutError",
                })
              ),
            TOKEN_TIMEOUT_MS
          )
        ),
      ]);
      setToken({ state: "ok", length: res.token?.length || 0, ms: Math.round(performance.now() - start) });
    } catch (e) {
      setToken({ state: "error", text: formatRawError(e), details: errorDetails(e) });
    }
  }, []);

  useEffect(() => {
    checkToken();
    return onLastAIError(setLastError);
  }, [checkToken]);

  async function testCloud() {
    setCloudTest({ state: "running" });
    const start = performance.now();
    try {
      const { text, source } = await runPrompt({
        taskKey: "ask",
        parts: [{ text: "Reply with exactly: OK" }],
        mode: InferenceMode.ONLY_IN_CLOUD,
      });
      setCloudTest({ state: "ok", text: `${source}: "${text.trim().slice(0, 80)}" in ${Math.round(performance.now() - start)}ms` });
    } catch (e) {
      setCloudTest({ state: "error", text: formatRawError(e) });
    }
  }

  const opts = app.options || {};
  const rows = [
    ["App Check provider", APP_CHECK_PROVIDER],
    [
      "VITE_RECAPTCHA_ENTERPRISE_SITE_KEY",
      RECAPTCHA_ENTERPRISE_SITE_KEY
        ? `set (${RECAPTCHA_ENTERPRISE_SITE_KEY.slice(0, 6)}…, ${RECAPTCHA_ENTERPRISE_SITE_KEY.length} chars)`
        : "NOT SET in this build",
    ],
    ["App Check initialized", appCheck ? `yes (${APP_CHECK_PROVIDER})` : "no"],
    ["App Check debug token mode", appCheckDebugMode ? "ON (debug provider token)" : "off"],
    [
      "App Check token prefetch (on load)",
      prefetch.status === "ok"
        ? `ok · length ${prefetch.length} · ${prefetch.ms}ms · ${prefetch.at}`
        : prefetch.status === "error"
          ? `error · ${prefetch.at} (see below)`
          : prefetch.status,
    ],
    ["App Check & on-device AI", "Not needed: Firebase AI Logic only attaches App Check tokens to cloud requests"],
    ["navigator.onLine", String(navigator.onLine)],
    ["Firebase projectId", opts.projectId || "(missing)"],
    ["Firebase appId", opts.appId || "(missing)"],
    ["Page origin", window.location.origin],
    ["Cloud model (Remote Config)", getConfig().cloud_model_name],
  ];

  return (
    <section className="panel debug" aria-label="Diagnostics">
      <div className="debug-head">
        <h2>Diagnostics</h2>
        <span className="sec-n">?debug=1 · {online ? "online" : "offline"}</span>
      </div>

      <dl className="debug-grid">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <div className="debug-block">
        <div className="debug-row">
          <h3>getToken(appCheck, false)</h3>
          <button className="ghost" onClick={checkToken} disabled={token.state === "running"}>
            {token.state === "running" ? "Checking…" : "Re-run"}
          </button>
        </div>
        {token.state === "ok" && (
          <p className="ok-text">
            Success: token length {token.length} ({token.ms}ms)
          </p>
        )}
        {token.state === "error" && <pre className="debug-pre bad">{token.text}{token.details ? `\n\n${safeJson(token.details)}` : ""}</pre>}
        {token.state === "running" && <p className="hint">Requesting a token…</p>}
      </div>

      <div className="debug-block">
        <div className="debug-row">
          <h3>Cloud test call (ONLY_IN_CLOUD)</h3>
          <button className="ghost" onClick={testCloud} disabled={!online || cloudTest.state === "running"}>
            {cloudTest.state === "running" ? "Calling…" : "Run"}
          </button>
        </div>
        {cloudTest.state === "ok" && <p className="ok-text">{cloudTest.text}</p>}
        {cloudTest.state === "error" && <pre className="debug-pre bad">{cloudTest.text}</pre>}
        {cloudTest.state === "idle" && <p className="hint">Sends a tiny prompt through Firebase AI Logic to isolate cloud/App Check problems.</p>}
      </div>

      {prefetch.status === "error" && <pre className="debug-pre bad">{prefetch.error}</pre>}

      <div className="debug-block">
        <div className="debug-row">
          <h3>Offline Q&amp;A test (ONLY_ON_DEVICE, sample pack)</h3>
          <button className="ghost" onClick={runQaTest} disabled={qaTest.state === "running"}>
            {qaTest.state === "running" ? "Running…" : "Run"}
          </button>
        </div>
        {qaTest.state === "idle" && <p className="hint">Asks “{QA_TEST_QUESTION}” against the bundled ECO 201 pack, on this device only.</p>}
        {qaTest.state === "running" && <p className="hint">Running on device…</p>}
        {(qaTest.state === "pass" || qaTest.state === "fail") && (
          <pre className={`debug-pre ${qaTest.state === "fail" ? "bad" : ""}`}>{qaTest.text}</pre>
        )}
      </div>

      <div className="debug-block">
        <h3>Last pack build timings</h3>
        {buildTimings ? <pre className="debug-pre">{formatBuildTimings(buildTimings)}</pre> : <p className="hint">No pack built on this device yet.</p>}
      </div>

      <div className="debug-block">
        <h3>Last AI error</h3>
        {lastError ? (
          <>
            <p className="hint">
              {lastError.at} · task {lastError.context?.task} · mode {lastError.context?.mode} · online {String(lastError.context?.online)}
            </p>
            <pre className="debug-pre bad">{lastError.text}</pre>
            <details>
              <summary>Raw JSON</summary>
              <pre className="debug-pre">{safeJson(lastError.details)}</pre>
            </details>
          </>
        ) : (
          <p className="hint">None yet in this session.</p>
        )}
      </div>
    </section>
  );
}

function formatBuildTimings(t) {
  const ms = (v) => (v == null ? "–" : `${(v / 1000).toFixed(2)}s`);
  const lines = [
    `${t.at} · model ${t.model} · thinking ${t.thinking}${t.finishing ? ` · finishing ${t.finishing.join(", ")}` : ""}`,
    t.finishing ? null : `Files wait:          ${ms(t.filesWaitMs)}`,
    t.finishing ? null : `Stage 1 (outline):   ${ms(t.stage1Ms)}   (pack opened at ${ms(t.outlineSavedMs)})`,
    `Stage 2 (parallel):  ${ms(t.stage2Ms)}`,
    ...Object.entries(t.calls || {}).map(
      ([k, c]) => `  ${k.padEnd(11)} ${ms(c.ms).padStart(7)}  ${c.ok ? "ok" : "FAILED"}${c.attempts > 1 ? ` (${c.attempts} attempts)` : ""}${c.error ? ` · ${c.error}` : ""}`
    ),
    t.finishing ? null : `Time to first section: ${ms(t.firstSectionMs)}`,
    `Total:               ${ms(t.totalMs)} · ${t.complete ? "complete" : "partial"}${t.questionTarget ? ` · target ${t.questionTarget} questions` : ""}`,
  ];
  return lines.filter(Boolean).join("\n");
}
