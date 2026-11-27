import { useEffect, useState } from "react";
import { getPack, deletePack } from "../lib/db.js";
import { exportPack } from "../lib/packs.js";
import { removeRemotePack } from "../lib/sync.js";
import { PackQuiz, PackAsk } from "./PackStudy.jsx";

const TABS = [
  { key: "read", label: "Read" },
  { key: "quiz", label: "Quiz" },
  { key: "ask", label: "Ask" },
];

/** One pack in Blackout Study Mode: Read (no AI), adaptive Quiz, Ask (on-device first). */
export default function PackView({ packId, online, onStatus, onBack }) {
  const [pack, setPack] = useState(undefined);
  const [tab, setTab] = useState("read");

  useEffect(() => {
    getPack(packId).then((p) => setPack(p || null));
  }, [packId]);

  if (pack === undefined)
    return (
      <section className="panel loading">
        <div className="pulse" /> Opening pack…
      </section>
    );
  if (pack === null)
    return (
      <section className="panel empty">
        <h3>Pack not found.</h3>
        <button className="ghost" onClick={onBack}>
          ← Back to packs
        </button>
      </section>
    );

  return (
    <>
      <div className="pack-head">
        <button className="linkish back" onClick={onBack}>
          ← All packs
        </button>
        <span className="pack-code">{pack.courseCode || "Study pack"}</span>
        <h2>{pack.title}</h2>
        {pack.summary && <p className="pack-summary">{pack.summary}</p>}
        <div className="pack-actions">
          <button className="ghost" onClick={() => exportPack(pack)} title="Saves a file you can send by Bluetooth or flash drive">
            ⇡ Share pack
          </button>
          <button
            className="ghost danger"
            onClick={async () => {
              if (!window.confirm(`Delete "${pack.title}"? This can't be undone.`)) return;
              await deletePack(pack.id);
              removeRemotePack(pack.id);
              onBack();
            }}
          >
            Delete
          </button>
          <span className="pack-count">
            {pack.sections.length} sections · {pack.questions.length} questions
          </span>
        </div>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "read" && <ReadMode pack={pack} />}
      {tab === "quiz" && <PackQuiz pack={pack} online={online} onStatus={onStatus} />}
      {tab === "ask" && <PackAsk pack={pack} online={online} onStatus={onStatus} />}
    </>
  );
}

export function ReadMode({ pack }) {
  return (
    <div className="read">
      <nav className="toc panel" aria-label="Sections">
        <ol>
          {pack.sections.map((s, i) => (
            <li key={s.id}>
              <a href={`#sec-${s.id}`} onClick={(e) => {
                e.preventDefault();
                document.getElementById(`sec-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}>
                <span>{String(i + 1).padStart(2, "0")}</span> {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {pack.sections.map((s, i) => (
        <article key={s.id} id={`sec-${s.id}`} className="panel section">
          <span className="sec-n">Section {i + 1}</span>
          <h3>{s.title}</h3>
          <div className="prose">{s.explanation}</div>
          {s.keyTerms.length > 0 && (
            <dl className="terms">
              {s.keyTerms.map((k) => (
                <div key={k.term}>
                  <dt>{k.term}</dt>
                  <dd>{k.definition}</dd>
                </div>
              ))}
            </dl>
          )}
          {s.workedExample && (
            <div className="example">
              <span>Worked example</span>
              <div className="prose">{s.workedExample}</div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
