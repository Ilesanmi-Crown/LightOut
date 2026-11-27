import { useEffect, useState } from "react";
import { listPacks, getQuestionStats } from "../lib/db.js";
import SavingsCard from "../components/SavingsCard.jsx";

/** Packs home: every pack saved on this device (IndexedDB), newest first. */
export default function PackLibrary({ online, refreshKey, onOpen, onNew, children }) {
  const [packs, setPacks] = useState(null);
  const [mastery, setMastery] = useState({});

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
          <button className="cta small" onClick={onNew} title={online ? "" : "Building a pack needs internet"}>
            <span>New pack</span>
            <span className="arrow" aria-hidden="true">＋</span>
          </button>
        </div>
      </div>

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
            Build one from your lecture notes, PDFs or photos while you have data, or try the sample pack to see Blackout Study
            Mode straight away.
          </p>
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
