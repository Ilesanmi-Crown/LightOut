import { useEffect, useRef, useState } from "react";
import { listPacks, getQuestionStats, getPack, putPack } from "../lib/db.js";
import { readPackFile, validatePack } from "../lib/packs.js";
import { pushPack } from "../lib/sync.js";
import samplePackFile from "../samplePack.json";
import SavingsCard from "../components/SavingsCard.jsx";
import ErrorNote from "../components/ErrorNote.jsx";
import OfflineBrainPanel from "../components/OfflineBrainPanel.jsx";

const STEPS = [
  { icon: "📄", label: "Upload your notes" },
  { icon: "✨", label: "Build a study pack" },
  { icon: "🔦", label: "Study offline, anywhere" },
];

/** Packs home: hero + every pack saved on this device, newest first. */
export default function PackLibrary({ online, status, refreshKey, onOpen, onNew }) {
  const [packs, setPacks] = useState(null);
  const [mastery, setMastery] = useState({});
  const [error, setError] = useState("");
  const importInput = useRef(null);

  async function loadSample() {
    setError("");
    const sample = validatePack(samplePackFile.pack);
    const existing = await getPack(sample.id);
    if (!existing) {
      const pack = { ...sample, updatedAt: Date.now() };
      await putPack(pack);
      pushPack(pack);
    }
    onOpen(sample.id);
  }

  async function importFile(file) {
    if (!file) return;
    setError("");
    try {
      const pack = await readPackFile(file);
      const existing = await getPack(pack.id);
      if (existing && !window.confirm(`You already have "${existing.title}". Replace it with the imported copy?`)) return;
      await putPack(pack);
      pushPack(pack);
      onOpen(pack.id);
    } catch (e) {
      setError(`Couldn't import that file. ${e.message}`);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await listPacks();
      if (!alive) return;
      setPacks(list);
      const m = {};
      for (const p of list) {
        const stats = await getQuestionStats(p.id);
        const mastered = p.questions.filter((q) => stats[q.id]?.lastResult === "right").length;
        m[p.id] = { mastered, total: p.questions.length };
      }
      if (alive) setMastery(m);
    })();
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  return (
    <>
      <section className="hero home">
        <h1 aria-label="Study through every blackout.">
          <span className="line" aria-hidden="true">
            <span>Study through</span>
          </span>
          <span className="line" aria-hidden="true">
            <span>
              every <em className="flicker">blackout</em>.
            </span>
          </span>
        </h1>
        <p className="lede">Turn your notes into study packs while you have data. Keep learning offline when the light goes.</p>
        <ol className="hero-steps" aria-label="How it works">
          {STEPS.map((st, i) => (
            <li key={st.label}>
              <span className="hero-step-icon" aria-hidden="true">
                {st.icon}
              </span>
              <span className="hero-step-n">{i + 1}</span>
              <span>{st.label}</span>
            </li>
          ))}
        </ol>
        <p className="hero-note">AI runs on your device when it can, in the cloud when it must.</p>
        <div className="hero-actions">
          <button className="cta" onClick={loadSample}>
            <span>Try a sample pack</span>
            <span className="arrow" aria-hidden="true">→</span>
          </button>
          <button className="btn-secondary" onClick={onNew}>
            Build your own
          </button>
        </div>
      </section>

      <OfflineBrainPanel status={status} online={online} />

      <div className="library-head">
        <h2>Your packs</h2>
        {packs?.length > 0 && (
          <button className="linkish" onClick={() => importInput.current?.click()} title="Open a pack file shared by a classmate">
            Import a pack
          </button>
        )}
        <input
          ref={importInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            importFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      <ErrorNote error={error} />
      <SavingsCard />

      {packs === null ? (
        <section className="panel loading">
          <div className="pulse" /> Loading your packs…
        </section>
      ) : packs.length === 0 ? (
        <section className="empty-line">
          <p>No packs yet. Got one from a classmate?</p>
          <button className="ghost" onClick={() => importInput.current?.click()}>
            Import a pack file
          </button>
        </section>
      ) : (
        <ul className="pack-grid">
          {packs.map((p, i) => {
            const m = mastery[p.id];
            const pct = m && m.total ? Math.round((m.mastered / m.total) * 100) : 0;
            return (
              <li key={p.id} style={{ "--i": i }}>
                <button className="pack-card" onClick={() => onOpen(p.id)}>
                  <span className="pack-code">{p.courseCode || "Pack"}</span>
                  <span className="pack-title">{p.title}</span>
                  <span className="pack-meta">
                    {p.sections.length} sections · {p.questions.length} questions
                    {p.source === "sample" ? " · sample" : p.source === "imported" ? " · imported" : ""}
                    {p.build ? (p.build.status === "building" ? " · writing…" : " · unfinished") : ""}
                  </span>
                  <span className="pack-progress" aria-label={`${pct}% mastered`}>
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span className="pack-mastery">{m ? `${m.mastered}/${m.total} mastered` : " "}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
