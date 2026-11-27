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

// ---------- Ask about this pack ----------
const STOP = new Set(
  "the a an and or of to in on for is are was were be been it its this that these those with as at by from what why how when which who whom does do did can could should would will shall about into than then there their them they you your i me my we our us not no yes if so but also more most less very much many any some all each per vs".split(
    " "
  )
);

function tokens(text) {
  return (text.toLowerCase().match(/[a-z0-9₦]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
}

// Tiny stemmer so "elastic"/"elasticity", "price"/"prices" overlap.
function stem(w) {
  return w.replace(/(ities|ity|ies|ing|ed|es|s)$/, "");
}

export const ASK_CONTEXT_LIMIT = 12_000; // chars; on-device limit is ~9216 tokens for prompt + answer

function sectionText(s) {
  return [
    `SECTION: ${s.title}`,
    s.explanation,
    s.keyTerms.length ? `Key terms: ${s.keyTerms.map((k) => `${k.term}: ${k.definition}`).join("; ")}` : "",
    s.workedExample ? `Worked example: ${s.workedExample}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Picks the 2-3 most relevant sections by keyword overlap. */
export function pickSections(pack, question) {
  const q = new Set(tokens(question));
  const ranked = pack.sections
    .map((s) => {
      const titleHits = tokens(s.title).filter((t) => q.has(t)).length;
      const termHits = tokens(s.keyTerms.map((k) => k.term).join(" ")).filter((t) => q.has(t)).length;
      const bodyHits = tokens(`${s.explanation} ${s.workedExample}`).filter((t) => q.has(t)).length;
      return { s, score: titleHits * 3 + termHits * 2 + bodyHits };
    })
    .sort((a, b) => b.score - a.score);
  const relevant = ranked.filter((r) => r.score > 0);
  const chosen = (relevant.length ? relevant : ranked).slice(0, relevant.length >= 3 ? 3 : 2);
  return { sections: chosen.map((r) => r.s), matched: relevant.length > 0 };
}

export function buildAskContext(pack, question) {
  const { sections, matched } = pickSections(pack, question);
  let context = "";
  for (const s of sections) {
    const block = sectionText(s);
    if (context.length + block.length + 2 > ASK_CONTEXT_LIMIT) {
      context += `\n\n${block.slice(0, Math.max(0, ASK_CONTEXT_LIMIT - context.length - 2))}`;
      break;
    }
    context += (context ? "\n\n" : "") + block;
  }
  return { context, sections, matched };
}

export function askPrompt({ pack, question, context }) {
  return [
    {
      text: `You are a patient tutor for ${pack.courseCode ? `${pack.courseCode} ` : ""}"${pack.title}".
Answer the student's question using ONLY the study pack excerpts below. Use simple language and short paragraphs.
If the excerpts don't contain the answer, say clearly: "This pack doesn't cover that." and suggest which topic to look up. Do not make up facts.

STUDY PACK EXCERPTS:
"""
${context}
"""

STUDENT'S QUESTION: ${question}`,
    },
  ];
}
