import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyError, runPrompt, InferenceMode, InferenceSource } from "../ai.js";
import { askPack, askRoute, getHistory, addHistory, clearHistory, isTimeout } from "../lib/ask.js";
import { SourceBadge, PrivacyLine } from "../components/AIMeta.jsx";
import CloudRetry from "../components/CloudRetry.jsx";
import ErrorNote from "../components/ErrorNote.jsx";
import RetryNotice from "../components/RetryNotice.jsx";

const UNAVAILABLE_TEXT =
  "Asking questions offline needs the offline brain (Chrome on a laptop). You can still read this pack and take the quiz.";

/** "Ask about this pack": on-device first, grounded in the pack, with per-pack history. */
export default function PackAsk({ pack, online, status, goTo }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null); // the answer being written / just written
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const answerRef = useRef(null);

  const loadHistory = useCallback(() => getHistory(pack.id).then(setHistory), [pack.id]);
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const offlineUnavailable = !online && status !== "available" && status !== "checking";

  async function ask(e, { bypassCache = false, q = question } = {}) {
    e?.preventDefault?.();
    const text = q.trim();
    if (!text || busy) return;
    setError(null);
    setBlocked(false);
    const route = await askRoute(online);
    setBusy(true);
    setLive({ question: text, text: "", streaming: true });
    try {
      const r = await askPack({
        pack,
        question: text,
        history,
        mode: route.mode, // undefined when offline without the offline brain: only a saved answer can be used
        bypassCache,
        onText: (t) => setLive({ question: text, text: t, streaming: true }),
      });
      const turn = { packId: pack.id, question: text, answer: r.text, sections: r.sections, source: r.source, ms: r.ms, cached: r.cached };
      setLive({ ...turn, streaming: false, parts: r.parts, id: Date.now() });
      if (!r.cached) await addHistory(turn);
      loadHistory();
      setQuestion("");
      requestAnimationFrame(() => answerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    } catch (err) {
      console.error(err);
      setLive(null);
      if (err?.code === "no-route") setBlocked(true);
      else if (isTimeout(err)) setError("Taking too long — try a shorter question.");
      else setError(friendlyError(err, { online })); // raw error stays in ?debug=1
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    if (!window.confirm("Clear the questions and answers for this pack?")) return;
    await clearHistory(pack.id);
    setLive(null);
    loadHistory();
  }

  const suggestions = pack.sections.slice(0, 3).map((s) => `Explain ${s.title.toLowerCase()}`);
  // Earlier turns (newest first), without the one currently shown in full.
  const past = history.filter((h) => !(live && !live.streaming && h.question === live.question && h.answer === live.answer)).reverse();

  return (
    <div className="pack-ask">
      {(offlineUnavailable || blocked) && (
        <section className="panel ask-unavailable" role="status">
          <p>{UNAVAILABLE_TEXT}</p>
          <div className="row-actions">
            <button type="button" className="cta small" onClick={() => goTo("read")}>
              <span>Read</span>
              <span className="arrow" aria-hidden="true">
                →
              </span>
            </button>
            <button type="button" className="btn-secondary" onClick={() => goTo("quiz")}>
              Quiz
            </button>
          </div>
        </section>
      )}

      <form className="panel ask-form" onSubmit={ask}>
        <label htmlFor="ask-q">Ask about this pack</label>
        <div className="ask-row">
          <input
            id="ask-q"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={history.length ? "Ask a follow-up, e.g. explain that simpler…" : "Ask a question about this pack…"}
            maxLength={400}
            disabled={busy}
          />
          <button className="cta" type="submit" disabled={busy || !question.trim()} aria-busy={busy}>
            <span>{busy ? "Thinking…" : "Ask"}</span>
            <span className="arrow" aria-hidden="true">
              {busy ? <span className="btn-spinner" /> : "→"}
            </span>
          </button>
        </div>
        {!history.length && (
          <div className="suggest">
            {suggestions.map((s) => (
              <button type="button" key={s} className="ghost" onClick={() => setQuestion(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>
        )}
      </form>

      {busy && <RetryNotice />}
      <ErrorNote error={error} />

      {live && (
        <AnswerCard
          refEl={answerRef}
          turn={live}
          online={online}
          goTo={goTo}
          onRegenerate={!live.streaming ? () => ask(null, { bypassCache: true, q: live.question }) : null}
          busy={busy}
        />
      )}

      {history.length > 0 && (
        <section className="ask-history" aria-label="Earlier questions">
          <div className="ask-history-head">
            <h3>{past.length ? "Earlier questions" : "Saved on this device"}</h3>
            <button type="button" className="linkish" onClick={handleClear} disabled={busy}>
              Clear
            </button>
          </div>
          {past.map((h) => (
            <details key={h.id} className="ask-turn">
              <summary>{h.question}</summary>
              <AnswerBody turn={h} goTo={goTo} />
            </details>
          ))}
        </section>
      )}
    </div>
  );
}

function AnsweredFrom({ sections, goTo }) {
  if (!sections?.length) return null;
  return (
    <p className="answered-from">
      Answered from:{" "}
      {sections.map((s, i) => (
        <span key={s.id}>
          {i > 0 && " · "}
          <button type="button" className="linkish" onClick={() => goTo("read", s.id)}>
            {s.title}
          </button>
        </span>
      ))}
    </p>
  );
}

function AnswerBody({ turn, goTo }) {
  return (
    <>
      <div className="ask-turn-meta">
        <SourceBadge source={turn.source} ms={turn.ms} />
      </div>
      <div className="prose">{turn.answer}</div>
      <PrivacyLine source={turn.source} />
      <AnsweredFrom sections={turn.sections} goTo={goTo} />
    </>
  );
}

function AnswerCard({ refEl, turn, online, goTo, onRegenerate, busy }) {
  return (
    <section className="panel result" ref={refEl}>
      <div className="result-head">
        <h2 className="ask-q-title">{turn.question}</h2>
        <div className="result-badges">
          {turn.cached && <span className="badge saved">Saved answer</span>}
          <SourceBadge source={turn.source} ms={turn.ms} streaming={turn.streaming} />
          {onRegenerate && (
            <button type="button" className="regen-btn" onClick={onRegenerate} disabled={busy}>
              ↻ Regenerate
            </button>
          )}
        </div>
      </div>
      {turn.streaming ? (
        <div className="prose is-streaming">{turn.text}</div>
      ) : (
        <CloudRetry
          key={turn.id}
          source={turn.source}
          online={online}
          deviceSummary={<SourceBadge source={turn.source} ms={turn.ms} />}
          renderData={(text, { streaming }) => <div className={`prose ${streaming ? "is-streaming" : ""}`}>{text}</div>}
          onRetry={async (onText) => {
            const r = await runPrompt({ taskKey: "ask", parts: turn.parts, mode: InferenceMode.ONLY_IN_CLOUD, onText });
            return { data: r.text, source: r.source ?? InferenceSource.IN_CLOUD, ms: r.ms };
          }}
        >
          <div className="prose">{turn.answer}</div>
          <PrivacyLine source={turn.source} />
        </CloudRetry>
      )}
      {!turn.streaming && <AnsweredFrom sections={turn.sections} goTo={goTo} />}
    </section>
  );
}
