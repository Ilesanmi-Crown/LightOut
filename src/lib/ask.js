// "Ask about this pack": context selection, prompt budget, history and a reliable on-device-first call.
// ALL inference goes through Firebase AI Logic (runPrompt); nothing calls Chrome's LanguageModel directly.
import { runPrompt, InferenceMode, InferenceSource, getOnDeviceStatus } from "../ai.js";
import { local } from "./db.js";
import { answerKey, getAnswer, putAnswer } from "./answerCache.js";
import { setLastAIError } from "./diagnostics.js";

export const PROMPT_CHAR_BUDGET = 24_000; // whole prompt; leaves room for the answer within Nano's 9,216 tokens
export const ASK_TIMEOUT_MS = 60_000;
export const HISTORY_TURNS = 3;

// ---------- Context selection ----------
const STOPWORDS = new Set(
  (
    "a about above after again against all am an and any are as at be because been before being below between both but by can could " +
    "did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in " +
    "into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same " +
    "she should so some such than that the their theirs them themselves then there these they this those through to too under until up " +
    "very was we were what when where which while who whom why will with would you your yours yourself yourselves explain tell please " +
    "simple simpler mean means meaning example give show"
  ).split(" ")
);

/** Simple stemming: strip -ing, -ed, -es, -s. */
export function stem(w) {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function terms(text) {
  return (String(text).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 1 && !STOPWORDS.has(w)).map(stem);
}

function hits(qset, text) {
  let n = 0;
  for (const t of terms(text)) if (qset.has(t)) n++;
  return n;
}

/** Scores sections (title x3, key terms x2, explanation + example x1) and picks the top 2-3. */
export function selectSections(pack, question) {
  const qset = new Set(terms(question));
  const ready = pack.sections.filter((s) => !s.pending); // skip sections still being written
  const scored = ready
    .map((s) => ({
      s,
      score:
        hits(qset, s.title) * 3 +
        hits(qset, s.keyTerms.map((k) => `${k.term} ${k.definition}`).join(" ")) * 2 +
        hits(qset, `${s.explanation} ${s.workedExample}`),
    }))
    .sort((a, b) => b.score - a.score);
  const positive = scored.filter((x) => x.score > 0);
  if (!positive.length) return { sections: ready.slice(0, 1), matched: false, useSummary: true };
  return { sections: positive.slice(0, 3).map((x) => x.s), matched: true, useSummary: false };
}

function sectionBlock(s) {
  return [
    `### ${s.title}`,
    s.explanation,
    s.keyTerms.length ? `Key terms: ${s.keyTerms.map((k) => `${k.term}: ${k.definition}`).join("; ")}` : "",
    s.workedExample ? `Worked example: ${s.workedExample}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- Prompt with budget ----------
function instructions(pack) {
  return `You are a patient tutor for ${pack.courseCode ? `${pack.courseCode} ` : ""}"${pack.title}".
Answer the student's question ONLY from the study material below, in simple language, in at most about 150 words.
If the material doesn't cover it, say "This isn't covered in this pack" and suggest the closest section title.
Section titles in this pack: ${pack.sections.map((s) => s.title).join("; ")}.`;
}

/**
 * Builds the single-turn prompt (instructions + context + last turns + question), kept under
 * PROMPT_CHAR_BUDGET by trimming context first, then history.
 */
export function buildAskPrompt({ pack, question, history = [] }) {
  const { sections, matched, useSummary } = selectSections(pack, question);
  const head = instructions(pack);
  const q = `STUDENT'S QUESTION: ${question.trim()}`;
  let contextBlocks = [...(useSummary && pack.summary ? [`### Pack summary\n${pack.summary}`] : []), ...sections.map(sectionBlock)];
  let turns = history.slice(-HISTORY_TURNS).map((t) => `Student: ${t.question}\nTutor: ${t.answer}`);

  const assemble = () =>
    [
      head,
      `STUDY MATERIAL:\n"""\n${contextBlocks.join("\n\n")}\n"""`,
      turns.length ? `EARLIER IN THIS CONVERSATION (for follow-up questions):\n${turns.join("\n\n")}` : "",
      q,
    ]
      .filter(Boolean)
      .join("\n\n");

  let text = assemble();
  // 1) Trim context: shorten the lowest-ranked block, then drop it, until within budget (keep at least 1,500 chars).
  while (text.length > PROMPT_CHAR_BUDGET && contextBlocks.join("").length > 1500) {
    const over = text.length - PROMPT_CHAR_BUDGET;
    const last = contextBlocks.length - 1;
    if (contextBlocks.length > 1 && contextBlocks[last].length <= over + 200) contextBlocks = contextBlocks.slice(0, last);
    else contextBlocks[last] = contextBlocks[last].slice(0, Math.max(500, contextBlocks[last].length - over - 50)) + "…";
    text = assemble();
  }
  // 2) Then history: drop the oldest turns.
  while (text.length > PROMPT_CHAR_BUDGET && turns.length) {
    turns = turns.slice(1);
    text = assemble();
  }
  // 3) Last resort: hard cap.
  if (text.length > PROMPT_CHAR_BUDGET) text = text.slice(0, PROMPT_CHAR_BUDGET - q.length - 2) + "\n\n" + q;

  return { parts: [{ text }], sections: sections.map((s) => ({ id: s.id, title: s.title })), matched, chars: text.length };
}

// ---------- History ----------
export const getHistory = (packId) => local.qa.where("packId").equals(packId).sortBy("at");
export const addHistory = (row) => local.qa.add({ ...row, at: Date.now() });
export const clearHistory = (packId) => local.qa.where("packId").equals(packId).delete();

// ---------- Routing + call ----------
/** Offline: ONLY_ON_DEVICE (only if the offline brain is ready). Online: PREFER_ON_DEVICE. */
export async function askRoute(online) {
  if (online) return { mode: InferenceMode.PREFER_ON_DEVICE };
  const status = await getOnDeviceStatus();
  if (status !== "available") return { unavailable: true, status };
  return { mode: InferenceMode.ONLY_ON_DEVICE };
}

class AskTimeoutError extends Error {
  constructor() {
    super(`Ask timed out after ${ASK_TIMEOUT_MS / 1000}s`);
    this.name = "AskTimeoutError";
    this.code = "timeout";
  }
}
export const isTimeout = (e) => e?.name === "AskTimeoutError";

/**
 * Runs one question. Uses the saved answer when the same question + context + history was asked before
 * (unless bypassCache). Streams via onText. Rejects with AskTimeoutError after 60 s.
 */
export async function askPack({ pack, question, history, mode, onText, bypassCache = false, label = "ask", countSavings = true }) {
  const built = buildAskPrompt({ pack, question, history });
  const key = await answerKey({ task: `ask:${pack.id}`, text: built.parts[0].text });
  if (!bypassCache) {
    const hit = await getAnswer(key);
    if (hit) return { ...built, text: hit.data, source: hit.source, ms: hit.ms, cached: true };
  }
  if (!mode) throw Object.assign(new Error("No route"), { code: "no-route" });

  const controller = new AbortController();
  const timeoutMs = globalThis.__LIGHTOUT_ASK_TIMEOUT_MS || ASK_TIMEOUT_MS; // override exists only for automated tests
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(); // cancels a cloud request; an on-device answer that arrives late is ignored
      const err = new AskTimeoutError();
      setLastAIError(err, { task: label, mode, online: navigator.onLine });
      reject(err);
    }, timeoutMs);
  });
  let live = true;
  try {
    const r = await Promise.race([
      runPrompt({ taskKey: "ask", parts: built.parts, mode, signal: controller.signal, label, countSavings, onText: (t) => live && onText?.(t) }),
      timeout,
    ]);
    putAnswer(key, { task: "ask", data: r.text, source: r.source, ms: r.ms });
    return { ...built, text: r.text, source: r.source, ms: r.ms, cached: false };
  } finally {
    live = false;
    clearTimeout(timer);
  }
}

export { InferenceSource };
