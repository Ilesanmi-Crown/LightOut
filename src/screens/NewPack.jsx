import { useEffect, useRef, useState } from "react";
import { ACCEPT, MAX_TOTAL_BYTES, formatBytes, detectKind } from "../lib/ingest.js";
import { createPrepareQueue } from "../lib/prepareQueue.js";
import { startBuild } from "../lib/packBuilder.js";
import { friendlyError } from "../ai.js";
import { useElapsed } from "../hooks.js";
import { SourceBadge } from "../components/AIMeta.jsx";
import ErrorNote from "../components/ErrorNote.jsx";
import { SAMPLE_NOTES } from "../sampleNotes.js";

const KIND_LABEL = { pdf: "PDF", docx: "Word", txt: "Text", image: "Photo" };

// The rest of these steps continue in the pack view (see BuildProgress) once the outline is saved.
export const BUILD_STAGES = [
  { key: "reading", label: "Reading files", activeLabel: "Finishing your files…" },
  { key: "uploading", label: "Uploading" },
  { key: "outlining", label: "Outlining" },
  { key: "sections", label: "Writing sections (0/2)" },
  { key: "questions", label: "Writing questions (0/2)" },
  { key: "saved", label: "Saved" },
];
const STAGES = BUILD_STAGES;

// Until a photo is prepared we don't know its final size; resized JPEGs land well under 1 MB.
const estimateBytes = (it) => (it.status === "ready" ? it.payloadBytes : it.kind === "image" ? Math.min(it.size, 1024 * 1024) : it.size);

export default function NewPack({ online, onCreated }) {
  const [title, setTitle] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [pasted, setPasted] = useState("");
  // { id, name, size, kind, status: "preparing" | "ready" | "error", payload?, payloadBytes?, previewUrl?, error? }
  const [items, setItems] = useState([]);
  const [stage, setStage] = useState(null);
  const [error, setError] = useState("");
  const [built, setBuilt] = useState(null); // { ms, source }
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const cameraInput = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const elapsed = useElapsed(stage === "uploading" || stage === "outlining");

  // Background preparation: starts the moment a file is added (max 3 at once).
  const queueRef = useRef(null);
  if (!queueRef.current) {
    queueRef.current = createPrepareQueue((id, patch) =>
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
    );
  }
  useEffect(() => () => queueRef.current.cancelAll(), []);

  const pastedBytes = new TextEncoder().encode(pasted).length;
  const totalBytes = items.reduce((n, it) => n + estimateBytes(it), 0) + pastedBytes;
  const overLimit = totalBytes > MAX_TOTAL_BYTES;
  const hasContent = pasted.trim().length > 0 || items.length > 0;
  const building = stage !== null;
  const preparingCount = items.filter((it) => it.status === "preparing").length;

  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setError("");
    const added = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      kind: detectKind(file),
      status: "preparing",
      file,
    }));
    setItems((prev) => [...prev, ...added]);
    for (const it of added) queueRef.current.add(it.id, it.file);
  }

  function removeItem(id) {
    queueRef.current.remove(id); // cancels the job and discards its result
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
      setError("Add notes, files or photos first.");
      return;
    }
    const start = performance.now();
    try {
      // Step 1-3 already ran in the background; only wait for files still preparing.
      setStage("reading");
      const queue = queueRef.current;
      const ids = itemsRef.current.map((it) => it.id);
      if (ids.some((id) => !queue.result(id))) await queue.whenIdle();
      // Read results from the queue (the source of truth), not from React state, which may lag a render.
      const ready = itemsRef.current
        .filter((it) => ids.includes(it.id))
        .map((it) => ({ ...it, ...queue.result(it.id) }));
      const failed = ready.filter((it) => it.status !== "ready");
      if (failed.length) {
        setStage(null);
        setError(`Couldn't read ${failed.map((f) => `"${f.name}"`).join(", ")}. Remove it to build your pack.`);
        return;
      }
      const finalBytes = ready.reduce((n, it) => n + it.payloadBytes, 0) + pastedBytes;
      if (finalBytes > MAX_TOTAL_BYTES) {
        setStage(null);
        setError(`That's ${formatBytes(finalBytes)}. Remove a file to get under 15 MB.`);
        return;
      }
      // Step 4: the ONLY_IN_CLOUD build, using the prepared payloads. Stage 1 (outline) first;
      // as soon as it's saved we open the pack, and Stage 2 (4 parallel calls) fills it in.
      const filesWaitMs = performance.now() - start;
      setStage("uploading");
      const t = setTimeout(() => setStage((s) => (s === "uploading" ? "outlining" : s)), 1500);
      const { pack } = await startBuild({
        title,
        courseCode,
        pasted,
        items: ready.map(({ name, payload, hash }) => ({ name, payload, hash })),
        t0: start,
        filesWaitMs,
      });
      clearTimeout(t);
      setBuilt({ ms: performance.now() - start, source: null });
      setStage(null);
      onCreated(pack);
    } catch (e) {
      console.error(e);
      setStage(null);
      // Our own validation errors (no Firebase error code) get a short explanation;
      // everything from the SDK/network is shown raw.
      const fromSdk = Boolean(e?.code) || /FirebaseError|AIError/.test(e?.name || "");
      setError(fromSdk ? friendlyError(e, { online: navigator.onLine }) : { text: "The pack didn't come out right. Try again.", details: String(e?.message || e) });
    }
  }

  const stageIndex = STAGES.findIndex((s) => s.key === stage);

  return (
    <>
      <div className="screen-head">
        <h2>New study pack</h2>
        <p>Add your notes, PDFs or photos. We&apos;ll turn them into a pack you can study offline.</p>
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
            placeholder="Paste lecture notes or a handout…"
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
            <span>PDF, Word, text or photos · up to 15 MB</span>
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

        {items.length > 0 && (
          <ul className="chips" aria-label="Files in this pack">
            {items.map((it) => (
              <li key={it.id} className={`chip is-${it.status}`}>
                {it.previewUrl ? <img src={it.previewUrl} alt="" /> : <span className="chip-kind">{KIND_LABEL[it.kind] || "File"}</span>}
                <span className="chip-name" title={it.status === "error" ? it.error : it.name}>
                  {it.name}
                </span>
                <span className="chip-status" aria-live="polite">
                  {it.status === "preparing" ? (
                    <>
                      <span className="btn-spinner" aria-hidden="true" /> Preparing…
                    </>
                  ) : it.status === "ready" ? (
                    <>
                      Ready ✓ <span className="chip-size">{formatBytes(it.payloadBytes)}</span>
                    </>
                  ) : (
                    "Couldn't read this file"
                  )}
                </span>
                <button type="button" className="chip-x" onClick={() => removeItem(it.id)} disabled={building} aria-label={`Remove ${it.name}`}>
                  ×
                </button>
              </li>
            ))}
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
          <button className="cta" onClick={handleBuild} disabled={!online || building || !hasContent || overLimit}>
            <span>{building ? "Building…" : "Build pack"}</span>
            <span className="arrow" aria-hidden="true">
              {building ? <span className="btn-spinner" /> : "→"}
            </span>
          </button>
        </div>
        {!online && <p className="offline-note">Building a pack needs internet. Do it while you have light and data.</p>}

        {building && (
          <ol className="stages" aria-live="polite">
            {STAGES.map((s, i) => (
              <li key={s.key} className={i < stageIndex ? "done" : i === stageIndex ? "active" : ""}>
                <span className="stage-dot" aria-hidden="true">
                  {i < stageIndex ? "✓" : i === stageIndex ? <span className="btn-spinner" /> : ""}
                </span>
                {i === stageIndex && s.activeLabel ? s.activeLabel : s.label}
                {i === stageIndex && (s.key === "uploading" || s.key === "outlining") && elapsed > 0 && (
                  <span className="stage-time">{elapsed}s</span>
                )}
              </li>
            ))}
            <li className="stage-hint">This can take a minute.</li>
          </ol>
        )}

        {built && <SourceBadge source={built.source} ms={built.ms} />}

        <ErrorNote error={error} />
      </section>
    </>
  );
}
