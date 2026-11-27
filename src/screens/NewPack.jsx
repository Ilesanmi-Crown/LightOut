import { useRef, useState } from "react";
import { ACCEPT, MAX_TOTAL_BYTES, formatBytes, ingestFile } from "../lib/ingest.js";
import { buildPack } from "../lib/packs.js";
import { putPack } from "../lib/db.js";
import { pushPack } from "../lib/sync.js";
import { friendlyError } from "../ai.js";
import { useElapsed } from "../hooks.js";
import { SourceBadge } from "../components/AIMeta.jsx";
import { SAMPLE_NOTES } from "../sampleNotes.js";

const KIND_LABEL = { pdf: "PDF", docx: "DOCX", txt: "TXT", image: "Photo" };

const STAGES = [
  { key: "reading", label: "Reading your files" },
  { key: "uploading", label: "Sending to Gemini in the cloud" },
  { key: "building", label: "Writing sections and the question bank" },
  { key: "saving", label: "Saving for offline study" },
];

export default function NewPack({ online, onCreated }) {
  const [title, setTitle] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [pasted, setPasted] = useState("");
  const [items, setItems] = useState([]); // ingested files
  const [pending, setPending] = useState(0); // files still being read
  const [stage, setStage] = useState(null);
  const [error, setError] = useState("");
  const [built, setBuilt] = useState(null); // { ms, source }
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const cameraInput = useRef(null);
  const elapsed = useElapsed(stage === "uploading" || stage === "building");

  const pastedBytes = new TextEncoder().encode(pasted).length;
  const totalBytes = items.reduce((n, it) => n + it.payloadBytes, 0) + pastedBytes;
  const overLimit = totalBytes > MAX_TOTAL_BYTES;
  const hasContent = pasted.trim().length > 0 || items.length > 0;
  const building = stage !== null;

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setError("");
    setPending((n) => n + files.length);
    const errors = [];
    await Promise.all(
      files.map(async (f) => {
        try {
          const it = await ingestFile(f);
          setItems((prev) => [...prev, it]);
        } catch (e) {
          errors.push(e.message || String(e));
        } finally {
          setPending((n) => n - 1);
        }
      })
    );
    if (errors.length) setError(errors.join(" "));
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  async function handleBuild() {
    setError("");
    setBuilt(null);
    if (!online) {
      setError("Building a pack needs internet. Do it while you have light and data.");
      return;
    }
    if (!hasContent) {
      setError("Add some notes, files or photos first.");
      return;
    }
    if (overLimit) {
      setError(`That's ${formatBytes(totalBytes)} of material. The limit is 15 MB per pack, so remove a file or split it into two packs.`);
      return;
    }
    const start = performance.now();
    try {
      setStage("reading");
      await new Promise((r) => setTimeout(r, 250)); // files are already read; let the stage render
      setStage("uploading");
      const buildPromise = buildPack({ title, courseCode, pasted, items });
      // The request is one call; flip to "building" once the upload has had a moment.
      const t = setTimeout(() => setStage((s) => (s === "uploading" ? "building" : s)), 2500);
      const { pack, source } = await buildPromise;
      clearTimeout(t);
      setStage("saving");
      await putPack(pack);
      pushPack(pack); // fire-and-forget sync; IndexedDB is the source of truth
      setBuilt({ ms: performance.now() - start, source });
      setStage(null);
      onCreated(pack);
    } catch (e) {
      console.error(e);
      setStage(null);
      setError(
        /JSON|pack|section|question/i.test(e?.message || "")
          ? `The AI's pack didn't come out right (${e.message}). Please try again.`
          : friendlyError(e, { online: navigator.onLine })
      );
    }
  }

  const stageIndex = STAGES.findIndex((s) => s.key === stage);

  return (
    <>
      <div className="screen-head">
        <h2>New study pack</h2>
        <p>
          <strong>Prep with light, study in the dark.</strong> Upload your course materials while you have data. Gemini in the
          cloud turns them into explanations and a question bank you can study offline.
        </p>
      </div>

      <section className="panel newpack">
        <div className="field-row">
          <label className="field">
            <span>Pack title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Elasticity" maxLength={120} disabled={building} />
          </label>
          <label className="field narrow">
            <span>Course code</span>
            <input value={courseCode} onChange={(e) => setCourseCode(e.target.value)} placeholder="ECO 201" maxLength={30} disabled={building} />
          </label>
        </div>

        <div className="field">
          <span className="field-label-row">
            <span>Paste notes (optional)</span>
            <button type="button" className="linkish" onClick={() => setPasted(SAMPLE_NOTES)} disabled={building}>
              use sample notes
            </button>
          </span>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            placeholder="Paste lecture notes, a handout or a past question here…"
            disabled={building}
          />
        </div>

        <div
          className={`dropzone ${dragging ? "is-drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!building) addFiles(e.dataTransfer.files);
          }}
        >
          <p>
            <strong>Add files or photos</strong>
            <span>PDF, DOCX, TXT, JPEG, PNG, WebP, HEIC · up to 15 MB per pack</span>
          </p>
          <div className="dz-actions">
            <button type="button" className="ghost" onClick={() => fileInput.current?.click()} disabled={building}>
              ＋ Choose files
            </button>
            <button type="button" className="ghost" onClick={() => cameraInput.current?.click()} disabled={building}>
              📷 Take photo
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {(items.length > 0 || pending > 0) && (
          <ul className="chips" aria-label="Files in this pack">
            {items.map((it) => (
              <li key={it.id} className="chip">
                {it.previewUrl ? <img src={it.previewUrl} alt="" /> : <span className="chip-kind">{KIND_LABEL[it.kind]}</span>}
                <span className="chip-name" title={it.name}>
                  {it.name}
                </span>
                <span className="chip-size">{formatBytes(it.payloadBytes)}</span>
                <button type="button" className="chip-x" onClick={() => removeItem(it.id)} disabled={building} aria-label={`Remove ${it.name}`}>
                  ×
                </button>
              </li>
            ))}
            {pending > 0 && (
              <li className="chip is-pending">
                <span className="btn-spinner" aria-hidden="true" /> Reading {pending} file{pending > 1 ? "s" : ""}…
              </li>
            )}
          </ul>
        )}

        <div className="size-meter" aria-live="polite">
          <div className="limit">
            <div className={overLimit ? "over-bad" : ""} style={{ width: `${Math.min(100, (totalBytes / MAX_TOTAL_BYTES) * 100)}%` }} />
          </div>
          <span className={overLimit ? "warn-text" : ""}>
            {formatBytes(totalBytes)} of 15 MB{overLimit ? " · too big, remove a file" : ""}
          </span>
        </div>

        <div className="build-row">
          <button className="cta" onClick={handleBuild} disabled={!online || building || pending > 0 || !hasContent || overLimit}>
            <span>{building ? "Building…" : "Build pack"}</span>
            <span className="arrow" aria-hidden="true">
              {building ? <span className="btn-spinner" /> : "→"}
            </span>
          </button>
          <span className="badge cloud">☁️ Runs in the cloud</span>
        </div>
        {!online && <p className="offline-note">Building a pack needs internet. Do it while you have light and data.</p>}

        {building && (
          <ol className="stages" aria-live="polite">
            {STAGES.map((s, i) => (
              <li key={s.key} className={i < stageIndex ? "done" : i === stageIndex ? "active" : ""}>
                <span className="stage-dot" aria-hidden="true">
                  {i < stageIndex ? "✓" : i === stageIndex ? <span className="btn-spinner" /> : ""}
                </span>
                {s.label}
                {i === stageIndex && (s.key === "uploading" || s.key === "building") && elapsed > 0 && (
                  <span className="stage-time">{elapsed}s</span>
                )}
              </li>
            ))}
            <li className="stage-hint">Big packs can take a minute. Keep this tab open.</li>
          </ol>
        )}

        {built && <SourceBadge source={built.source} ms={built.ms} />}

        {error && (
          <p className="error" role="alert">
            <span aria-hidden="true">!</span>
            {error}
          </p>
        )}
      </section>
    </>
  );
}
