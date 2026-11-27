import { useCallback, useEffect, useRef, useState } from "react";
import {
  TASKS,
  chooseRoute,
  runTask,
  getOnDeviceStatus,
  downloadOfflineBrain,
  friendlyError,
  ON_DEVICE_CHAR_LIMIT,
  InferenceSource,
} from "./ai.js";
import Flashcards from "./components/Flashcards.jsx";
import Quiz from "./components/Quiz.jsx";
import PhotoPicker from "./components/PhotoPicker.jsx";
import { SAMPLE_NOTES } from "./sampleNotes.js";

const NOTES_KEY = "lightout-notes:v1";
const STATS_KEY = "lightout-stats:v1";
const EMPTY_STATS = { device: 0, cloud: 0 };

function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY) || "null");
    return s && Number.isFinite(s.device) && Number.isFinite(s.cloud) ? s : EMPTY_STATS;
  } catch {
    return EMPTY_STATS;
  }
}

function saveStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* storage blocked: stats stay in memory for this visit */
  }
}

function formatSecs(ms) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Shows "offline" while offline, then "back" for 3 seconds after reconnecting. */
function useConnectionBanner(online) {
  const [banner, setBanner] = useState(online ? null : "offline");
  const wasOffline = useRef(!online);
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      setBanner("offline");
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setBanner("back");
    const t = setTimeout(() => setBanner(null), 3000);
    return () => clearTimeout(t);
  }, [online]);
  return banner;
}

function loadNotes() {
  try {
    return localStorage.getItem(NOTES_KEY) || "";
  } catch {
    return "";
  }
}

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

const BRAIN_SHORT = {
  checking: "Checking",
  unsupported: "Not supported",
  unavailable: "Unavailable",
  downloadable: "Not downloaded",
  downloading: "Downloading",
  available: "Ready",
};

const TASK_BLURB = {
  summarize: "The key points, in bullets",
  explain: "Like you're 15",
  flashcards: "Tap to flip",
  quiz: "5 questions, scored",
};

export default function App() {
  const online = useOnline();
  const [notes, setNotes] = useState(loadNotes);
  const [saved, setSaved] = useState(true);
  const [image, setImage] = useState(null); // { mimeType, base64, previewUrl, name }
  const [status, setStatus] = useState("checking");
  const [progress, setProgress] = useState(null); // 0..1 while downloading
  const [busy, setBusy] = useState(null); // task key
  const [result, setResult] = useState(null); // { taskKey, data, source, reason, ms, streaming }
  const [error, setError] = useState("");
  const [stats, setStats] = useState(loadStats);
  const banner = useConnectionBanner(online);
  const resultRef = useRef(null);

  function recordSource(source) {
    const key = source === InferenceSource.ON_DEVICE ? "device" : source === InferenceSource.IN_CLOUD ? "cloud" : null;
    if (!key) return;
    setStats((prev) => {
      const next = { ...prev, [key]: prev[key] + 1 };
      saveStats(next);
      return next;
    });
  }

  function resetStats() {
    setStats(EMPTY_STATS);
    saveStats(EMPTY_STATS);
  }

  function loadSample() {
    if (notes.trim() && notes !== SAMPLE_NOTES && !window.confirm("Replace your current notes with the sample notes?")) return;
    setNotes(SAMPLE_NOTES);
    setError("");
  }

  // Autosave notes (debounced).
  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => {
      try {
        localStorage.setItem(NOTES_KEY, notes);
      } catch {
        /* storage full or blocked: notes stay in memory */
      }
      setSaved(true);
    }, 400);
    return () => clearTimeout(t);
  }, [notes]);

  const refreshStatus = useCallback(async () => {
    setStatus(await getOnDeviceStatus());
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus, online]);

  async function handleDownload() {
    setError("");
    setProgress(0);
    setStatus("downloading");
    try {
      await downloadOfflineBrain((p) => setProgress(p));
      setProgress(1);
    } catch (e) {
      setError(`Couldn't download the offline brain: ${e?.message || e}`);
    } finally {
      await refreshStatus();
      setTimeout(() => setProgress(null), 1200);
    }
  }

  async function handleTask(taskKey) {
    setError("");
    if (!notes.trim() && !image) {
      setError("Paste or type some notes (or add a photo of them) first.");
      return;
    }
    const route = chooseRoute({ chars: notes.length, online });
    if (route.error) {
      setError(route.error);
      return;
    }
    // Offline: the SDK would try to download the model and hang, so check ourselves first.
    if (!online) {
      const s = await getOnDeviceStatus();
      setStatus(s);
      if (s !== "available") {
        setError(
          s === "unsupported" || s === "unavailable"
            ? "You're offline and this browser can't run AI on-device. Reconnect to use the cloud, or open the app in Chrome desktop 139+."
            : "You're offline and the offline brain isn't downloaded yet. Reconnect, then tap \"Download the offline brain\"."
        );
        return;
      }
    }
    setBusy(taskKey);
    setResult(null);
    const scrollToResult = () =>
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    let scrolled = false;
    const start = performance.now();
    try {
      const { data, source } = await runTask({
        taskKey,
        notes,
        image,
        mode: route.mode,
        // Text tasks stream: show the words as they arrive.
        onText: (text) => {
          setResult({ taskKey, data: text, source: null, reason: route.reason, streaming: true });
          if (!scrolled) {
            scrolled = true;
            scrollToResult();
          }
        },
      });
      const ms = performance.now() - start;
      setResult({ taskKey, data, source, reason: route.reason, ms, streaming: false });
      recordSource(source);
      if (!scrolled) scrollToResult();
    } catch (e) {
      setResult(null);
      console.error(e);
      setError(friendlyError(e, { online }));
    } finally {
      setBusy(null);
    }
  }

  const tooLong = notes.length > ON_DEVICE_CHAR_LIMIT;
  const canDownload = online && (status === "downloadable" || status === "downloading") && progress === null;
  const brainTone = status === "available" ? "ok" : status === "unsupported" || status === "unavailable" ? "bad" : "warn";
  const pct = progress === null ? 0 : Math.round(progress * 100);

  // "Lights out" theme: the whole UI dims when the network drops.
  useEffect(() => {
    document.documentElement.dataset.power = online ? "on" : "off";
  }, [online]);

  return (
    <div className="app">
      <div className="glow" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      {banner && (
        <div className={`conn-banner ${banner}`} role="status" aria-live="polite">
          {banner === "offline" ? (
            <>
              <strong>⚡ No light, no data? Lightout is still working.</strong>
              <span>
                {status === "available"
                  ? "Your offline brain is ready. Everything runs on this device."
                  : "Download the offline brain next time you're online to use AI with no data."}
              </span>
            </>
          ) : (
            <strong>Back online — cloud available again</strong>
          )}
        </div>
      )}

      <header className="topbar">
        <a className="mark" href="/" aria-label="Lightout home">
          <img src="/icon.svg" alt="" width="34" height="34" />
          <span className="wordmark">
            Light<span className="out">out</span>
            <small>Notes</small>
          </span>
        </a>
        <div className="meter" role="status" aria-live="polite">
          <div className={`reading ${online ? "ok" : "bad"}`}>
            <span className="k">Grid</span>
            <span className="v">
              <span className="dot" />
              {online ? "Online" : "Offline"}
            </span>
          </div>
          <div className={`reading ${brainTone}`}>
            <span className="k">Offline brain</span>
            <span className="v">
              <span className="dot" />
              {BRAIN_SHORT[status] || status}
            </span>
          </div>
        </div>
      </header>

      <section className="how" aria-label="How it works">
        <ol className="steps">
          <li>
            <span className="step-n">1</span> Paste your notes
          </li>
          <li aria-hidden="true" className="step-arrow">
            →
          </li>
          <li>
            <span className="step-n">2</span> AI runs on your laptop
          </li>
          <li aria-hidden="true" className="step-arrow">
            →
          </li>
          <li>
            <span className="step-n">3</span> Cloud only when needed
          </li>
        </ol>
        {status === "unsupported" && (
          <p className="how-note">
            Offline mode needs <strong>Chrome on desktop (v139+)</strong>. Other browsers still work via the cloud.
          </p>
        )}
      </section>

      <section className="hero">
        <p className="eyebrow">
          <span>Study assistant</span>
          <span>Lagos, NG</span>
          <span>{online ? "Grid: on" : "Generator mode"}</span>
        </p>
        <h1 aria-label="Study through the blackout.">
          <span className="line" aria-hidden="true">
            <span>Study through</span>
          </span>
          <span className="line" aria-hidden="true">
            <span>
              the <em className="flicker">blackout</em>.
            </span>
          </span>
        </h1>
        <div className="hero-foot">
          <p className="lede">
            Summaries, plain-English explanations, flashcards and quizzes, running on your laptop when NEPA takes light,
            and in the cloud when your notes are long.
          </p>
          <ol className="route" aria-label="How requests are routed">
            <li>
              <span className="n">≤20k</span>
              <span>chars</span>
              <b>→ your device</b>
            </li>
            <li>
              <span className="n">&gt;20k</span>
              <span>chars</span>
              <b>→ the cloud</b>
            </li>
            <li>
              <span className="n">0</span>
              <span>bars</span>
              <b>→ device only</b>
            </li>
          </ol>
        </div>
        <svg className="wire" viewBox="0 0 1200 40" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 20 H380 L410 4 L440 36 L470 8 L495 30 L515 20 H1200" />
        </svg>
      </section>

      {status !== "available" && status !== "checking" && status !== "unsupported" && (
        <section className={`panel onboarding ${status === "unavailable" ? "is-unsupported" : ""}`}>
          {status === "unavailable" ? (
            <div className="onb-grid">
              <div className="onb-num">⌁</div>
              <div>
                <h2>Cloud mode on this browser</h2>
                <p>
                  This device can't run the offline brain (Gemini Nano needs Chrome desktop v139+ on hardware that meets its
                  requirements). Everything below still works for you through the cloud while you're online.
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
                  Download the offline brain (Gemini Nano, a one-time download of a few GB) while you have Wi-Fi. After
                  that, every feature works with zero data.
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
              </div>
            </div>
          )}
        </section>
      )}

      <main className="workspace">
        <section className="panel editor">
          <div className="panel-head">
            <label htmlFor="notes">Your notes</label>
            <span className={`counter ${tooLong ? "warn-text" : ""}`}>
              {notes.length.toLocaleString()} chars{tooLong ? " · cloud only" : ""}
              <span className={`save ${saved ? "" : "is-saving"}`}>{saved ? "Saved" : "Saving"}</span>
            </span>
          </div>
          <div className="sample-row">
            <button type="button" className="sample-btn" onClick={loadSample} disabled={!!busy}>
              <span aria-hidden="true">✦</span> Try with sample notes
            </button>
            <span className="sample-meta">ECO 101 · demand, supply &amp; elasticity</span>
          </div>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Paste or type your lecture notes here. They're saved on this device automatically, so a power cut won't eat them."
            rows={12}
          />
          <div className="limit" aria-hidden="true">
            <div style={{ width: `${Math.min(100, (notes.length / ON_DEVICE_CHAR_LIMIT) * 100)}%` }} className={tooLong ? "over" : ""} />
          </div>
          <PhotoPicker image={image} onChange={setImage} onError={setError} />
        </section>

        <nav className="actions" aria-label="Study tools">
          {Object.entries(TASKS).map(([key, t], i) => (
            <button
              key={key}
              style={{ "--i": i }}
              onClick={() => handleTask(key)}
              disabled={!!busy}
              aria-busy={busy === key}
              className={busy === key ? "is-busy" : ""}
            >
              <span className="idx">{busy === key ? <span className="btn-spinner" aria-hidden="true" /> : `0${i + 1}`}</span>
              <span className="name">{busy === key ? (result?.streaming ? "Writing…" : "Thinking…") : t.label}</span>
              <span className="desc">{TASK_BLURB[key]}</span>
              <span className="arrow" aria-hidden="true">→</span>
            </button>
          ))}
        </nav>
      </main>

      <div className="stats" aria-live="polite">
        <span className="stat device">
          <b>{stats.device}</b> on-device
        </span>
        <span className="sep" aria-hidden="true">·</span>
        <span className="stat cloud">
          <b>{stats.cloud}</b> cloud
        </span>
        <span className="stats-label">requests on this device</span>
        {stats.device + stats.cloud > 0 && (
          <button type="button" className="reset" onClick={resetStats}>
            reset
          </button>
        )}
      </div>

      {error && (
        <p className="error" role="alert">
          <span aria-hidden="true">!</span>
          {error}
        </p>
      )}

      {busy && !result?.streaming && (
        <section className="panel loading" aria-live="polite">
          <div className="pulse" /> Working on {TASKS[busy].label.toLowerCase()}…
        </section>
      )}

      {result && (
        <section className="panel result" ref={resultRef}>
          <div className="result-head">
            <h2>{TASKS[result.taskKey].label}</h2>
            {result.streaming ? (
              <span className="badge streaming">
                <span className="dot" /> Generating…
              </span>
            ) : (
              <SourceBadge source={result.source} ms={result.ms} />
            )}
          </div>
          {result.taskKey === "flashcards" ? (
            <Flashcards cards={result.data.cards} />
          ) : result.taskKey === "quiz" ? (
            <Quiz questions={result.data.questions} />
          ) : (
            <div className={`prose ${result.streaming ? "is-streaming" : ""}`}>{result.data}</div>
          )}
          {!result.streaming && result.source === InferenceSource.ON_DEVICE && (
            <p className="privacy">🔒 Your notes never left this device.</p>
          )}
          <p className="hint route-note">{result.reason}</p>
        </section>
      )}

      <footer className="footer">
        <div className="ticker" aria-hidden="true">
          <div>
            {Array.from({ length: 2 }).map((_, k) => (
              <span key={k}>
                No light <i>✦</i> No data <i>✦</i> No problem <i>✦</i> Gemini Nano on-device <i>✦</i> Gemini in the cloud{" "}
                <i>✦</i>{" "}
              </span>
            ))}
          </div>
        </div>
        <p>Built with Firebase AI Logic hybrid inference.</p>
      </footer>
    </div>
  );
}

function SourceBadge({ source, ms }) {
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
