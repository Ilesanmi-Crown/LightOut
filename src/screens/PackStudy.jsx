import { useEffect, useState } from "react";
import { getQuestionStats, recordAnswer, resetQuestionStats } from "../lib/db.js";
import { addOfflineAnswer } from "../lib/savings.js";
import { pickRound, roundFocus, markAnswer, markInCloud } from "../lib/study.js";
import { friendlyError } from "../ai.js";
import CloudRetry from "../components/CloudRetry.jsx";
import ErrorNote from "../components/ErrorNote.jsx";
import RetryNotice from "../components/RetryNotice.jsx";
import { SourceBadge, PrivacyLine } from "../components/AIMeta.jsx";

const ROUND_SIZE = 10;

// ======================= Adaptive quiz =======================
export function PackQuiz({ pack, online, onStatus }) {
  const [stats, setStats] = useState(null);
  const [round, setRound] = useState(null);
  const [focus, setFocus] = useState(null);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState({}); // qid -> true/false

  async function newRound() {
    const s = await getQuestionStats(pack.id);
    const r = pickRound(pack.questions, s, ROUND_SIZE);
    setStats(s);
    setFocus(roundFocus(r, s));
    setRound(r);
    setIndex(0);
    setResults({});
  }

  useEffect(() => {
    newRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack.id]);

  async function record(q, correct) {
    setResults((r) => ({ ...r, [q.id]: correct }));
    await recordAnswer(pack.id, q.id, correct);
    if (!navigator.onLine) addOfflineAnswer();
  }

  async function handleReset() {
    if (!window.confirm("Reset your progress on this pack?")) return;
    await resetQuestionStats(pack.id);
    newRound();
  }

  if (!round)
    return (
      <section className="panel loading">
        <div className="pulse" /> Picking your questions…
      </section>
    );

  const done = index >= round.length;
  const score = Object.values(results).filter(Boolean).length;
  const seen = stats ? Object.keys(stats).length : 0;
  const mastered = stats ? pack.questions.filter((q) => stats[q.id]?.lastResult === "right").length : 0;

  return (
    <div className="pack-quiz">
      <div className="quiz-bar panel">
        <div>
          <b>{done ? round.length : index + 1}</b>/{round.length}
          <span className="quiz-focus">
            {focus?.missed ? `${focus.missed} you missed before · ` : ""}
            {focus?.fresh ? `${focus.fresh} new` : "review round"}
          </span>
        </div>
        <div className="quiz-progress" aria-hidden="true">
          <span style={{ width: `${((done ? round.length : index) / round.length) * 100}%` }} />
        </div>
        <span className="quiz-mastery">
          {mastered}/{pack.questions.length} mastered · {seen} seen
        </span>
      </div>

      {done ? (
        <section className="panel round-done">
          <span className="sec-n">Round complete</span>
          <h3>
            {score}/{round.length} correct
          </h3>
          <p>{score === round.length ? "Perfect round!" : "Missed questions come back first."}</p>
          <div className="row-actions">
            <button className="cta" onClick={newRound}>
              <span>Next round</span>
              <span className="arrow" aria-hidden="true">→</span>
            </button>
            <button className="ghost" onClick={handleReset}>
              Reset progress
            </button>
          </div>
        </section>
      ) : (
        <QuestionCard
          key={round[index].id}
          q={round[index]}
          section={pack.sections.find((s) => s.id === round[index].sectionId)}
          prevWrong={stats?.[round[index].id]?.lastResult === "wrong"}
          online={online}
          onStatus={onStatus}
          onAnswered={(correct) => record(round[index], correct)}
          onNext={() => setIndex((i) => i + 1)}
        />
      )}
    </div>
  );
}

function QuestionCard({ q, section, prevWrong, online, onStatus, onAnswered, onNext }) {
  const [picked, setPicked] = useState(null);
  const [answer, setAnswer] = useState("");
  const [marking, setMarking] = useState(false);
  const [mark, setMark] = useState(null); // { mark, source, ms }
  const [error, setError] = useState("");
  const [selfMarked, setSelfMarked] = useState(null);
  const [showModel, setShowModel] = useState(false);
  const answered = picked !== null || mark !== null || selfMarked !== null;

  function pick(i) {
    if (picked !== null) return;
    setPicked(i);
    onAnswered(i === q.answerIndex);
  }

  async function submitShort() {
    if (!answer.trim()) {
      setError("Write an answer first.");
      return;
    }
    setError("");
    setMarking(true);
    const start = performance.now();
    try {
      const res = await markAnswer({ question: q, answer, online });
      if (res.status) onStatus(res.status);
      if (res.error) {
        setError(`${res.error} Or mark yourself below.`);
        setShowModel(true);
        return;
      }
      setMark({ ...res, ms: performance.now() - start });
      setShowModel(true);
      onAnswered(res.mark.verdict === "correct");
    } catch (e) {
      console.error(e);
      const fe = friendlyError(e, { online });
      setError({ ...fe, text: `${fe.text} Or mark yourself below.` });
      setShowModel(true);
    } finally {
      setMarking(false);
    }
  }

  function selfMark(correct) {
    setSelfMarked(correct);
    onAnswered(correct);
  }

  return (
    <section className="panel qcard">
      <div className="qcard-meta">
        <span className="sec-n">{section?.title || "Question"}</span>
        <span className={`qtype ${q.type}`}>{q.type === "mcq" ? "Multiple choice" : "Short answer"}</span>
        {prevWrong && <span className="qtype again">Missed last time</span>}
      </div>
      <h3 className="qcard-q">{q.question}</h3>

      {q.type === "mcq" ? (
        <div className="options">
          {q.options.map((opt, j) => {
            let cls = "option";
            if (picked !== null && j === q.answerIndex) cls += " correct";
            else if (picked !== null && j === picked) cls += " wrong";
            return (
              <button key={j} className={cls} disabled={picked !== null} onClick={() => pick(j)}>
                <span className="letter">{String.fromCharCode(65 + j)}</span>
                <span>{opt}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="short-answer">
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={4}
            placeholder="Your answer, in your own words…"
            disabled={marking || answered}
          />
          {!answered && (
            <div className="row-actions">
              <button className="cta" onClick={submitShort} disabled={marking}>
                <span>{marking ? "Marking…" : "Mark my answer"}</span>
                <span className="arrow" aria-hidden="true">
                  {marking ? <span className="btn-spinner" /> : "✓"}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {mark && (
        <CloudRetry
          source={mark.source}
          online={online}
          renderData={(data) => <MarkView mark={data} />}
          onRetry={() => markInCloud(mark.parts)}
        >
          <MarkView mark={mark.mark} source={mark.source} ms={mark.ms} />
          <PrivacyLine source={mark.source} />
        </CloudRetry>
      )}

      {picked !== null && (
        <p className={`explain ${picked === q.answerIndex ? "ok-text" : "warn-text"}`}>
          {picked === q.answerIndex ? "Correct. " : "Not quite. "}
          <span>{q.explanation}</span>
        </p>
      )}

      {q.type === "short" && showModel && (
        <div className="model-answer">
          <span>Model answer</span>
          <p>{q.modelAnswer}</p>
          {q.explanation && <p className="hint">{q.explanation}</p>}
          {!mark && selfMarked === null && (
            <div className="row-actions">
              <button className="ghost" onClick={() => selfMark(true)}>
                I got it
              </button>
              <button className="ghost" onClick={() => selfMark(false)}>
                I missed it
              </button>
            </div>
          )}
        </div>
      )}


      {marking && <RetryNotice />}
      <ErrorNote error={error} />

      {answered && (
        <div className="row-actions end">
          <button className="cta" onClick={onNext} autoFocus>
            <span>Next question</span>
            <span className="arrow" aria-hidden="true">→</span>
          </button>
        </div>
      )}
    </section>
  );
}

function MarkView({ mark, source, ms }) {
  return (
    <div className={`ai-mark ${mark.verdict}`}>
      <div className="mark-head">
        <span className="mark-score">
          <b>{mark.score}</b>/10
        </span>
        <span className="mark-verdict">{mark.verdict === "correct" ? "Correct" : mark.verdict === "partly" ? "Partly right" : "Not quite"}</span>
        {source !== undefined && <SourceBadge source={source} ms={ms} />}
      </div>
      <p>{mark.feedback}</p>
    </div>
  );
}
