import { useCallback, useEffect, useState } from "react";
import { getToken } from "firebase/app-check";
import { app, appCheck, appCheckDebugMode, RECAPTCHA_SITE_KEY } from "../firebase.js";
import { errorDetails, formatRawError, getLastAIError, onLastAIError, safeJson } from "../lib/diagnostics.js";
import { getConfig } from "../lib/config.js";
import { runPrompt, InferenceMode } from "../ai.js";

const TOKEN_TIMEOUT_MS = 15_000;

/** Shown only with ?debug=1. Everything here is safe to screenshot: no secrets, site key truncated. */
export default function DebugPanel({ online }) {
  const [token, setToken] = useState({ state: "idle" });
  const [lastError, setLastError] = useState(getLastAIError);
  const [cloudTest, setCloudTest] = useState({ state: "idle" });

  const checkToken = useCallback(async () => {
    if (!appCheck) {
      setToken({ state: "error", text: "App Check was NOT initialized: VITE_RECAPTCHA_SITE_KEY was empty when this build was made." });
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
                Object.assign(new Error(`getToken did not settle within ${TOKEN_TIMEOUT_MS / 1000}s. The reCAPTCHA script (www.google.com/recaptcha) may be blocked (ad blocker, network) or slow.`), {
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
    ["VITE_RECAPTCHA_SITE_KEY", RECAPTCHA_SITE_KEY ? `set (${RECAPTCHA_SITE_KEY.slice(0, 6)}…, ${RECAPTCHA_SITE_KEY.length} chars)` : "NOT SET in this build"],
    ["App Check initialized", appCheck ? "yes (ReCaptchaV3Provider)" : "no"],
    ["App Check debug token mode", appCheckDebugMode ? "ON (debug provider token)" : "off"],
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
