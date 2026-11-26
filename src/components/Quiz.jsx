import { useState } from "react";

export default function Quiz({ questions }) {
  const [answers, setAnswers] = useState({});
  const answered = Object.keys(answers).length;
  const score = questions.reduce((n, q, i) => n + (answers[i] === q.answerIndex ? 1 : 0), 0);

  return (
    <div className="quiz">
      <p className="score">
        Score: {score} / {questions.length}
        {answered === questions.length && (score === questions.length ? " 🎉 Perfect!" : " · Review the explanations below.")}
      </p>
      {questions.map((q, i) => {
        const picked = answers[i];
        const done = picked !== undefined;
        return (
          <div key={i} className="question">
            <p className="q">
              {i + 1}. {q.question}
            </p>
            <div className="options">
              {q.options.map((opt, j) => {
                let cls = "option";
                if (done && j === q.answerIndex) cls += " correct";
                else if (done && j === picked) cls += " wrong";
                return (
                  <button key={j} className={cls} disabled={done} onClick={() => setAnswers((a) => ({ ...a, [i]: j }))}>
                    {String.fromCharCode(65 + j)}. {opt}
                  </button>
                );
              })}
            </div>
            {done && (
              <p className={`explain ${picked === q.answerIndex ? "ok-text" : "warn-text"}`}>
                {picked === q.answerIndex ? "Correct. " : "Not quite. "}
                {q.explanation}
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
