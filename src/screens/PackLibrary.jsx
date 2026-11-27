import { useEffect, useRef, useState } from "react";
import { listPacks, getQuestionStats, getPack, putPack } from "../lib/db.js";
import { readPackFile, validatePack } from "../lib/packs.js";
import { pushPack } from "../lib/sync.js";
import samplePackFile from "../samplePack.json";
import SavingsCard from "../components/SavingsCard.jsx";

/** Packs home: every pack saved on this device (IndexedDB), newest first. */
export default function PackLibrary({ online, refreshKey, onOpen, onNew, children }) {
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
      setError(`Couldn't import that file: ${e.message}`);
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
      <div className="screen-head row">
        <div>
          <h2>Your study packs</h2>
          <p>Saved on this device. Open one any time, even with no light and no data.</p>
        </div>
        <div className="head-actions">
          <button className="ghost" onClick={loadSample}>
            ✦ Try a sample pack
          </button>
          <button className="ghost" onClick={() => importInput.current?.click()} title="Open a .lightout.json file from a classmate">
            ⇣ Import pack
          </button>
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
          <button className="cta small" onClick={onNew} title={online ? "" : "Building a pack needs internet"}>
            <span>New pack</span>
            <span className="arrow" aria-hidden="true">＋</span>
          </button>
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          <span aria-hidden="true">!</span>
          {error}
        </p>
      )}
      <SavingsCard />
      {children}

      {packs === null ? (
        <section className="panel loading">
          <div className="pulse" /> Loading your packs…
        </section>
      ) : packs.length === 0 ? (
        <section className="panel empty">
          <h3>No packs yet</h3>
          <p>
            Build one from your lecture notes, PDFs or photos while you have data, try the sample pack to see Blackout Study
            Mode straight away, or import a <code>.lightout.json</code> pack a classmate shared over Bluetooth or a flash drive.
          </p>
          <div className="row-actions">
            <button className="cta" onClick={loadSample}>
              <span>Try a sample pack: ECO 201 Elasticity</span>
              <span className="arrow" aria-hidden="true">→</span>
            </button>
          </div>
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
