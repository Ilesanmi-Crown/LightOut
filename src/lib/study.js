// Blackout Study Mode helpers: adaptive question order, marking prompt, pack Q&A retrieval.
import { runPrompt, parseJson, prepareRoute, InferenceMode } from "../ai.js";

// ---------- Adaptive quiz ----------
/**
 * Orders the question bank so the questions the student got wrong come first,
 * then ones never seen, then ones answered correctly (least recently first).
 */
export function pickRound(questions, stats, size = 10) {
  const now = Date.now();
  const scored = questions.map((q) => {
    const s = stats[q.id];
    let score;
    if (!s) score = 50; // never seen
    else if (s.lastResult === "wrong") score = 100 + s.wrongStreak * 10;
    else score = 10 + Math.min(30, (now - (s.lastSeen || 0)) / 86_400_000); // right: older first
    return { q, score: score + Math.random() * 5 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.min(size, scored.length)).map((x) => x.q);
}

export function roundFocus(round, stats) {
  const missed = round.filter((q) => stats[q.id]?.lastResult === "wrong").length;
  const fresh = round.filter((q) => !stats[q.id]).length;
  return { missed, fresh };
}

// ---------- Short-answer marking (on-device first) ----------
export function markingPrompt({ question, modelAnswer, answer }) {
  return [
    {
      text: `You are a fair, encouraging university examiner marking a student's short answer.
Compare the STUDENT ANSWER with the MODEL ANSWER. Give credit for correct ideas in different words; ignore spelling and grammar.
Return ONLY JSON: {"score": integer 0-10, "verdict": "correct" | "partly" | "wrong", "feedback": "2-3 short sentences: what was right and what was missing"}.
Use "correct" for 8-10, "partly" for 4-7, "wrong" for 0-3.

QUESTION: ${question}
MODEL ANSWER: ${modelAnswer}
STUDENT ANSWER: ${answer}`,
    },
  ];
}

export function normaliseMark(raw) {
  const score = Math.max(0, Math.min(10, Math.round(Number(raw?.score) || 0)));
  const verdict = ["correct", "partly", "wrong"].includes(raw?.verdict)
    ? raw.verdict
    : score >= 8
      ? "correct"
      : score >= 4
        ? "partly"
        : "wrong";
  return { score, verdict, feedback: String(raw?.feedback || "").trim() || "Compare your answer with the model answer below." };
}

/** Marks one short answer. Returns { mark, source, mode, reason } or throws / returns { error }. */
export async function markAnswer({ question, answer, online }) {
  const parts = markingPrompt({ question: question.question, modelAnswer: question.modelAnswer, answer });
  const route = await prepareRoute({ chars: parts[0].text.length, online });
  if (route.error) return route;
  const { text, source } = await runPrompt({ taskKey: "mark", parts, mode: route.mode });
  return { mark: normaliseMark(parseJson(text)), source, reason: route.reason, parts };
}

/** Re-runs the exact same marking request in the cloud ("Retry in cloud"). */
export async function markInCloud(parts) {
  const { text, source, ms } = await runPrompt({ taskKey: "mark", parts, mode: InferenceMode.ONLY_IN_CLOUD });
  return { data: normaliseMark(parseJson(text)), source, ms };
}
