import { useEffect, useRef, useState } from "react";
import { TASKS, prepareRoute, runTask, friendlyError, ON_DEVICE_CHAR_LIMIT, InferenceSource, InferenceMode } from "../ai.js";
import CloudRetry from "../components/CloudRetry.jsx";
import ErrorNote from "../components/ErrorNote.jsx";
import { answerKey, getAnswer, putAnswer } from "../lib/answerCache.js";
import { sha256 } from "../lib/hash.js";
import Flashcards from "../components/Flashcards.jsx";
import Quiz from "../components/Quiz.jsx";
import PhotoPicker from "../components/PhotoPicker.jsx";
import { SourceBadge, PrivacyLine } from "../components/AIMeta.jsx";
import { SAMPLE_NOTES } from "../sampleNotes.js";

const NOTES_KEY = "lightout-notes:v1";
const STATS_KEY = "lightout-stats:v1";
const EMPTY_STATS = { device: 0, cloud: 0 };

const TASK_BLURB = {
  summarize: "The key points, in bullets",
  explain: "Like you're 15",
  flashcards: "Tap to flip",
  quiz: "5 questions, scored",
};

function loadNotes() {
  try {
    return localStorage.getItem(NOTES_KEY) || "";
  } catch {
    return "";
  }
}

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

/** The original single-turn tools: summarize, explain, flashcards, quiz. */
export default function QuickTools({ online, onStatus }) {
  const [notes, setNotes] = useState(loadNotes);
  const [saved, setSaved] = useState(true);
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null); // { taskKey, data, source, reason, ms, streaming }
  const [error, setError] = useState("");
  const [stats, setStats] = useState(loadStats);
  const resultRef = useRef(null);

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

  /** bypassCache: "Regenerate" always asks the AI again. */
  async function handleTask(taskKey, { bypassCache = false } = {}) {
    setError("");
    if (!notes.trim() && !image) {
      setError("Paste some notes or add a photo first.");
      return;
    }
    const request = { notes, image }; // snapshot so "Retry in cloud" re-sends exactly this
    const key = await answerKey({ task: taskKey, text: notes, fileHashes: image ? [await sha256(image.base64)] : [] });
    if (!bypassCache) {
      const hit = await getAnswer(key);
      if (hit) {
        // Same task, same notes, same photo, same model: show the saved answer instantly (works offline too).
        setResult({ id: Date.now(), taskKey, data: hit.data, source: hit.source, ms: hit.ms, cached: true, streaming: false, request, reason: "" });
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
        return;
      }
    }
    const route = await prepareRoute({ chars: notes.length, online });
    if (route.status) onStatus(route.status);
    if (route.error) {
      setError(route.error);
      return;
    }
    setBusy(taskKey);
    setResult(null);
    const scrollToResult = () => requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    let scrolled = false;
    const start = performance.now();
    const id = Date.now();
    try {
      const { data, source } = await runTask({
        taskKey,
        notes,
        image,
        mode: route.mode,
        // Text tasks stream: show the words as they arrive.
        onText: (text) => {
          setResult({ id, taskKey, data: text, source: null, reason: route.reason, streaming: true, request });
          if (!scrolled) {
            scrolled = true;
            scrollToResult();
          }
        },
      });
      const ms = performance.now() - start;
      setResult({ id, taskKey, data, source, reason: route.reason, ms, streaming: false, request });
      recordSource(source);
      putAnswer(key, { task: taskKey, data, source, ms });
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

  return (
    <>
      <div className="screen-head">
        <h2>Quick tools</h2>
        <p>Quick help with any notes, no pack needed.</p>
      </div>

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
            placeholder="Paste or type your notes here. They're saved automatically."
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
              <span className="arrow" aria-hidden="true">
                →
              </span>
            </button>
          ))}
        </nav>
      </main>

      {stats.device + stats.cloud > 0 && (
        <div className="stats" aria-live="polite">
          <span className="stat device">
            <b>{stats.device}</b> on-device
          </span>
          <span className="sep" aria-hidden="true">
            ·
          </span>
          <span className="stat cloud">
            <b>{stats.cloud}</b> cloud
          </span>
          <span className="stats-label">answers so far</span>
          {stats.device + stats.cloud > 0 && (
            <button type="button" className="reset" onClick={resetStats}>
              reset
            </button>
          )}
        </div>
      )}

      {error && <ErrorNote error={error} />}

      {busy && !result?.streaming && (
        <section className="panel loading" aria-live="polite">
          <div className="pulse" /> Working on {TASKS[busy].label.toLowerCase()}…
        </section>
      )}

      {result && (
        <section className="panel result" ref={resultRef}>
          <div className="result-head">
            <h2>{TASKS[result.taskKey].label}</h2>
            <div className="result-badges">
              {result.cached && <span className="badge saved">Saved answer</span>}
              <SourceBadge source={result.source} ms={result.ms} streaming={result.streaming} />
              {!result.streaming && (
                <button type="button" className="regen-btn" onClick={() => handleTask(result.taskKey, { bypassCache: true })} disabled={!!busy}>
                  ↻ Regenerate
                </button>
              )}
            </div>
          </div>
          <CloudRetry
            key={result.id}
            source={result.streaming ? null : result.source}
            online={online}
            deviceSummary={<SourceBadge source={result.source} ms={result.ms} />}
            renderData={(data, { streaming }) => renderTaskData(result.taskKey, data, streaming)}
            onRetry={async (onText) => {
              const r = await runTask({ taskKey: result.taskKey, ...result.request, mode: InferenceMode.ONLY_IN_CLOUD, onText });
              recordSource(r.source);
              return r;
            }}
          >
            {renderTaskData(result.taskKey, result.data, result.streaming)}
            {!result.streaming && <PrivacyLine source={result.source} />}
          </CloudRetry>
          {result.reason && <p className="hint route-note">{result.reason}</p>}
        </section>
      )}
    </>
  );
}

function renderTaskData(taskKey, data, streaming) {
  if (taskKey === "flashcards") return <Flashcards cards={data.cards} />;
  if (taskKey === "quiz") return <Quiz questions={data.questions} />;
  return <div className={`prose ${streaming ? "is-streaming" : ""}`}>{data}</div>;
}
