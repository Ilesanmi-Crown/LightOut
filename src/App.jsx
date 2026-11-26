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

const NOTES_KEY = "nepa-notes:v1";

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

const STATUS_TEXT = {
  checking: "Checking offline brain…",
  unsupported: "Offline brain: not supported",
  unavailable: "Offline brain: unavailable on this device",
  downloadable: "Offline brain: not downloaded",
  downloading: "Offline brain: downloading…",
  available: "Offline brain: ready",
};

export default function App() {
  const online = useOnline();
  const [notes, setNotes] = useState(loadNotes);
  const [saved, setSaved] = useState(true);
  const [image, setImage] = useState(null); // { mimeType, base64, previewUrl, name }
  const [status, setStatus] = useState("checking");
  const [progress, setProgress] = useState(null); // 0..1 while downloading
  const [busy, setBusy] = useState(null); // task key
  const [result, setResult] = useState(null); // { taskKey, data, source, reason }
  const [error, setError] = useState("");
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
    try {
      const { data, source } = await runTask({ taskKey, notes, image, mode: route.mode });
      setResult({ taskKey, data, source, reason: route.reason });
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      console.error(e);
      setError(friendlyError(e, { online }));
    } finally {
      setBusy(null);
    }
  }

  const tooLong = notes.length > ON_DEVICE_CHAR_LIMIT;
  const canDownload = online && (status === "downloadable" || status === "downloading") && progress === null;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img src="/icon.svg" alt="" width="36" height="36" />
          <div>
            <h1>NEPA-Proof Notes</h1>
            <p className="tagline">Study AI that keeps working when the light and data don't.</p>
          </div>
        </div>
        <div className="pills">
          <span className={`pill ${online ? "ok" : "bad"}`}>
            <span className="dot" /> {online ? "Online" : "Offline"}
          </span>
          <span className={`pill ${status === "available" ? "ok" : status === "unsupported" || status === "unavailable" ? "bad" : "warn"}`}>
            <span className="dot" /> {STATUS_TEXT[status] || status}
          </span>
        </div>
      </header>

      {status !== "available" && status !== "checking" && (
        <section className="card onboarding">
          {status === "unsupported" || status === "unavailable" ? (
            <p>
              <strong>Offline mode needs Chrome desktop v139+</strong> with the on-device Prompt API enabled
              {status === "unavailable" ? " and a device that meets Gemini Nano's hardware requirements" : ""}. The app still
              works for you through the cloud while you're online.
            </p>
          ) : (
            <>
              <p>
                <strong>Get ready for the next blackout.</strong> Download the offline brain (Gemini Nano, a one-time
                download of a few GB) while you have Wi-Fi. After that, summaries, flashcards and quizzes work with no data.
              </p>
              <button className="primary" onClick={handleDownload} disabled={!canDownload}>
                {progress !== null ? "Downloading…" : "Download the offline brain"}
              </button>
              {!online && <p className="hint">You need to be online to download it.</p>}
              {progress !== null && (
                <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                  <div className="bar" style={{ width: `${Math.round(progress * 100)}%` }} />
                  <span>{Math.round(progress * 100)}%</span>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <section className="card">
        <label htmlFor="notes" className="label">
          Your notes
          <span className={`counter ${tooLong ? "warn-text" : ""}`}>
            {notes.length.toLocaleString()} chars{tooLong ? " · cloud only" : ""} · {saved ? "saved" : "saving…"}
          </span>
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Paste or type your lecture notes here. They're saved on this device automatically."
          rows={10}
        />
        <PhotoPicker image={image} onChange={setImage} onError={setError} />

        <div className="actions">
          {Object.entries(TASKS).map(([key, t]) => (
            <button key={key} onClick={() => handleTask(key)} disabled={!!busy}>
              {busy === key ? "Thinking…" : t.label}
            </button>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      {busy && (
        <section className="card muted">
          <div className="spinner" /> Working on "{TASKS[busy].label}"…
        </section>
      )}

      {result && (
        <section className="card result" ref={resultRef}>
          <div className="result-head">
            <h2>{TASKS[result.taskKey].label}</h2>
            <SourceBadge source={result.source} />
          </div>
          {result.taskKey === "flashcards" ? (
            <Flashcards cards={result.data.cards} />
          ) : result.taskKey === "quiz" ? (
            <Quiz questions={result.data.questions} />
          ) : (
            <div className="prose">{result.data}</div>
          )}
          <p className="hint">{result.reason}</p>
        </section>
      )}

      <footer className="footer">
        Built with Firebase AI Logic hybrid inference: Gemini Nano in Chrome, Gemini in the cloud.
      </footer>
    </div>
  );
}

function SourceBadge({ source }) {
  if (source === InferenceSource.ON_DEVICE)
    return <span className="badge device">📱 Ran on your device</span>;
  if (source === InferenceSource.IN_CLOUD) return <span className="badge cloud">☁️ Ran in the cloud</span>;
  return null;
}
