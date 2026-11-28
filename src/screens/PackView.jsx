import { useEffect, useState } from "react";
import { getPack, deletePack } from "../lib/db.js";
import { exportPack } from "../lib/packs.js";
import { removeRemotePack } from "../lib/sync.js";
import { PackQuiz } from "./PackStudy.jsx";
import PackAsk from "./PackAsk.jsx";
import { onPackChange, isBuilding, missingParts, finishPack } from "../lib/packBuilder.js";
import ErrorNote from "../components/ErrorNote.jsx";
import { friendlyError } from "../ai.js";

const TABS = [
  { key: "read", label: "Read" },
  { key: "quiz", label: "Quiz" },
  { key: "ask", label: "Ask" },
];

/** One pack in Blackout Study Mode: Read (no AI), adaptive Quiz, Ask (on-device first). */
export default function PackView({ packId, online, status, onStatus, onBack }) {
  const [pack, setPack] = useState(undefined);
  const [tab, setTab] = useState("read");
  const [jumpTo, setJumpTo] = useState(null); // section id to scroll to after switching to Read

  const goTo = (nextTab, sectionId) => {
    setTab(nextTab);
    setJumpTo(sectionId || null);
    if (!sectionId) window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    if (tab !== "read" || !jumpTo) return;
    requestAnimationFrame(() => document.getElementById(`sec-${jumpTo}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    setJumpTo(null);
  }, [tab, jumpTo]);

  useEffect(() => {
    getPack(packId).then((p) => setPack(p || null));
    return onPackChange(packId, setPack); // live updates while the pack is being written
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
        {pack.build && <BuildProgress pack={pack} online={online} />}
        <div className="tabs" role="tablist">
          {TABS.map((t) => {
            const waiting = t.key === "quiz" && pack.questions.length === 0; // quiz opens with the first question batch
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={tab === t.key ? "on" : ""}
                onClick={() => setTab(t.key)}
                disabled={waiting}
                title={waiting ? "Questions are still being written" : undefined}
              >
                {t.label}
                {waiting ? " · writing…" : ""}
              </button>
            );
          })}
        </div>
      </div>
      {tab === "read" && <ReadMode pack={pack} />}
      {tab === "quiz" && pack.questions.length > 0 && <PackQuiz pack={pack} online={online} onStatus={onStatus} />}
      {tab === "ask" && <PackAsk pack={pack} online={online} status={status} goTo={goTo} />}
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
          {s.pending && (
            <p className="writing">
              <span className="btn-spinner" aria-hidden="true" /> Writing…
            </p>
          )}
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

const STEP_LABELS = { sections: "Writing sections", questions: "Writing questions" };

/** Reading files ✓ → Uploading ✓ → Outlining ✓ → Writing sections (x/2) → Writing questions (x/2) → Saved ✓ */
function BuildProgress({ pack, online }) {
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState(null);
  const parts = pack.build.parts || {};
  const count = (prefix) => ["A", "B"].filter((h) => parts[`${prefix}${h}`] === "done").length;
  const failed = (prefix) => ["A", "B"].some((h) => parts[`${prefix}${h}`] === "failed");
  const running = isBuilding(pack.id);
  const missing = missingParts(pack);
  const steps = [
    { label: "Reading files", state: "done" },
    { label: "Uploading", state: "done" },
    { label: "Outlining", state: "done" },
    ...["sections", "questions"].map((k) => ({
      label: `${STEP_LABELS[k]} (${count(k)}/2)`,
      state: count(k) === 2 ? "done" : failed(k) || (!running && count(k) < 2) ? "failed" : "active",
    })),
    { label: "Saved", state: running ? "todo" : "done" },
  ];

  async function finish() {
    setError(null);
    setFinishing(true);
    try {
      await finishPack(pack.id);
    } catch (e) {
      setError(e?.code ? friendlyError(e, { online }) : String(e?.message || e));
    } finally {
      setFinishing(false);
    }
  }

  return (
    <div className="build-progress" aria-live="polite">
      <ol className="build-steps">
        {steps.map((st) => (
          <li key={st.label} className={st.state}>
            <span className="stage-dot" aria-hidden="true">
              {st.state === "done" ? "✓" : st.state === "active" ? <span className="btn-spinner" /> : st.state === "failed" ? "!" : ""}
            </span>
            {st.label}
          </li>
        ))}
      </ol>
      {!running && missing.length > 0 && (
        <div className="finish-row">
          <span>Part of this pack didn&apos;t finish.</span>
          <button className="cta small" onClick={finish} disabled={finishing || !online}>
            <span>{finishing ? "Finishing…" : "Finish this pack"}</span>
            <span className="arrow" aria-hidden="true">
              {finishing ? <span className="btn-spinner" /> : "→"}
            </span>
          </button>
          {!online && <span className="hint inline">Needs internet.</span>}
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
