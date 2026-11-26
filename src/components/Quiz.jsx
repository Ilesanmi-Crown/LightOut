import { useState } from "react";

export default function Quiz({ questions }) {
  const [answers, setAnswers] = useState({});
  const answered = Object.keys(answers).length;
  const score = questions.reduce((n, q, i) => n + (answers[i] === q.answerIndex ? 1 : 0), 0);
  const finished = answered === questions.length;

  return (
    <div className="quiz">
      <p className="score" aria-live="polite">
        <b>
          {score}/{questions.length}
        </b>
        {finished ? (score === questions.length ? "Perfect. You're exam-ready." : "Review the explanations below.") : `${answered} of ${questions.length} answered`}
      </p>
      {questions.map((q, i) => {
        const picked = answers[i];
        const done = picked !== undefined;
        return (
          <div key={i} className={`question ${done ? "answered" : ""}`}>
            <p className="q">
              <span>{String(i + 1).padStart(2, "0")}</span>
              {q.question}
            </p>
            <div className="options">
              {q.options.map((opt, j) => {
                let cls = "option";
                if (done && j === q.answerIndex) cls += " correct";
                else if (done && j === picked) cls += " wrong";
                return (
                  <button key={j} className={cls} disabled={done} onClick={() => setAnswers((a) => ({ ...a, [i]: j }))}>
                    <span className="letter">{String.fromCharCode(65 + j)}</span>
                    <span>{opt}</span>
                  </button>
                );
              })}
            </div>
            {done && (
              <p className={`explain ${picked === q.answerIndex ? "ok-text" : "warn-text"}`}>
                {picked === q.answerIndex ? "Correct. " : "Not quite. "}
                <span>{q.explanation}</span>
              </p>
            )}
          </div>
        );
      })}
      {answered > 0 && (
        <button className="ghost" onClick={() => setAnswers({})}>
          Retry quiz
        </button>
      )}
    </div>
  );
}
