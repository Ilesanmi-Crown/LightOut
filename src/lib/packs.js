// Study Pack: validate, parallel-build prompts + merge, import/export.
import { getConfig } from "./config.js";

export const PACK_FORMAT = "lightout-pack";
export const PACK_VERSION = 1;

const str = (v) => (typeof v === "string" ? v.trim() : "");

function cleanKeyTerms(list) {
  return (Array.isArray(list) ? list : [])
    .filter((k) => k && str(k.term) && str(k.definition))
    .map((k) => ({ term: str(k.term), definition: str(k.definition) }));
}

function cleanQuestion(q, i, sectionIds, fallbackSectionId) {
  if (!q || !str(q.question)) return null;
  const id = str(q.id) || `q${i + 1}`;
  const sectionId = sectionIds.has(str(q.sectionId)) ? str(q.sectionId) : fallbackSectionId;
  const base = { id, sectionId, question: str(q.question), modelAnswer: str(q.modelAnswer), explanation: str(q.explanation) };
  if (q.type === "mcq") {
    const options = (Array.isArray(q.options) ? q.options : []).map(str).filter(Boolean).slice(0, 6);
    const answerIndex = Number(q.answerIndex);
    if (options.length < 2 || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) return null;
    return { ...base, type: "mcq", options, answerIndex, modelAnswer: base.modelAnswer || options[answerIndex] };
  }
  if (q.type === "short" && base.modelAnswer) return { ...base, type: "short" };
  return null;
}

/**
 * Validates and normalises a pack from any source (model output, import, Firestore).
 * A pack that is still being built (has `build`) may have pending sections and no questions yet.
 * Throws a readable Error when the shape is wrong. Returns a clean pack.
 */
export function validatePack(input) {
  const p = input && typeof input === "object" ? input : null;
  if (!p) throw new Error("That isn't a Lightout pack (no data).");
  const title = str(p.title);
  if (!title) throw new Error("The pack has no title.");
  if (!Array.isArray(p.sections) || p.sections.length === 0) throw new Error("The pack has no sections.");
  if (!Array.isArray(p.questions)) throw new Error("The pack has no question bank.");
  const building = p.build && typeof p.build === "object";

  const seen = new Set();
  const sections = p.sections
    .filter((s) => s && str(s.title) && (str(s.explanation) || (building && s.pending)))
    .map((s, i) => {
      let id = str(s.id) || `s${i + 1}`;
      if (seen.has(id)) id = `${id}-${i + 1}`;
      seen.add(id);
      const out = {
        id,
        title: str(s.title),
        explanation: str(s.explanation),
        keyTerms: cleanKeyTerms(s.keyTerms),
        workedExample: str(s.workedExample),
      };
      return building && s.pending && !out.explanation ? { ...out, pending: true } : out;
    });
  if (!sections.length) throw new Error("None of the pack's sections are complete.");
  const sectionIds = new Set(sections.map((s) => s.id));

  const qSeen = new Set();
  const questions = p.questions
    .map((q, i) => cleanQuestion(q, i, sectionIds, sections[0].id))
    .filter(Boolean)
    .map((q, i) => {
      let id = q.id;
      if (qSeen.has(id)) id = `${id}-${i + 1}`;
      qSeen.add(id);
      return { ...q, id };
    });
  if (!questions.length && !building) throw new Error("The pack's question bank is empty.");

  const now = Date.now();
  return {
    id: str(p.id) || crypto.randomUUID(),
    title,
    courseCode: str(p.courseCode),
    summary: str(p.summary),
    sections,
    questions,
    source: str(p.source) || "built",
    createdAt: Number(p.createdAt) || now,
    updatedAt: Number(p.updatedAt) || now,
    ...(building ? { build: p.build } : {}),
  };
}

// ---------- Parallel build: shared material, prompts, merge ----------
const ROLE = `You are an expert Nigerian university tutor building an offline "Study Pack" from a student's course materials.
Use simple language a first-year student can follow. Only use facts from the materials (you may add standard textbook
context to explain them). Use local Nigerian examples (Lagos markets, fuel, bread, danfo fares, naira prices) where natural.`;

/** The student's material as AI Logic parts, built once and reused by every call (no re-reading files). */
export function buildMaterialParts({ pasted = "", items = [] }) {
  const parts = [];
  if (pasted.trim()) parts.push({ text: `PASTED NOTES:\n"""\n${pasted.trim()}\n"""` });
  for (const it of items) if (it.payload?.text) parts.push({ text: `FILE "${it.name}":\n"""\n${it.payload.text}\n"""` });
  for (const it of items) {
    if (it.payload?.inlineData) {
      parts.push({ text: `Attached file: "${it.name}"` });
      parts.push({ inlineData: it.payload.inlineData });
    }
  }
  return parts;
}

export function outlinePrompt({ title, courseCode }) {
  return `${ROLE}

STEP 1 of 2: plan the pack. Course: ${courseCode || "(infer from the materials)"}. Pack title: ${title || "(infer a short, clear title)"}.
Return ONLY JSON matching the schema:
- "title" and "courseCode" (use the ones above if given).
- "summary": 3-5 sentences on what the pack covers.
- "sections": 5 to 10 sections that follow the materials' structure, each with a short unique "id" (s1, s2, ...) and a clear "title".
Do not write the section content yet.`;
}

const outlineText = (outline) =>
  `PACK OUTLINE (use these exact ids):\n${outline.sections.map((s) => `- ${s.id}: ${s.title}`).join("\n")}\nSummary: ${outline.summary}`;

export function sectionsPrompt({ outline, sections }) {
  return `${ROLE}

STEP 2: write the full content for ONLY these sections of the pack (other sections are written separately):
${sections.map((s) => `- ${s.id}: ${s.title}`).join("\n")}

${outlineText(outline)}

Return ONLY JSON: { "sections": [...] } with one entry per section above, in that order, keeping its "id" and "title". Each has
an "explanation" (2-4 short paragraphs), 3-6 "keyTerms" with clear definitions, and a "workedExample" (a step-by-step example or calculation).`;
}

export function questionsPrompt({ outline, sections, count }) {
  return `${ROLE}

STEP 2: write exam-style practice questions for ONLY these sections (other sections get their own questions separately):
${sections.map((s) => `- ${s.id}: ${s.title}`).join("\n")}

${outlineText(outline)}

Return ONLY JSON: { "questions": [...] } with at least ${count} questions spread across the sections above. Each question has a unique
"id" (q1, q2, ...) and the "sectionId" it tests (one of the ids above). Mix about 70% "mcq" and 30% "short".
- mcq: exactly 4 "options", "answerIndex" is the 0-based index of the correct option, plausible distractors.
- short: no options; "modelAnswer" is a complete 1-3 sentence answer a marker can compare against.
- Every question has a "modelAnswer" and an "explanation" of why the answer is right. Don't repeat the same question twice.`;
}

/** First half / second half of the outline's sections (A gets the extra one). */
export function splitHalves(sections) {
  const mid = Math.ceil(sections.length / 2);
  return { A: sections.slice(0, mid), B: sections.slice(mid) };
}

/** Total questions from Remote Config, split evenly between the two batches. */
export function splitQuestionCount() {
  const total = getConfig().pack_question_count;
  return { A: Math.ceil(total / 2), B: Math.floor(total / 2), total };
}

export function normaliseOutline(raw, { title, courseCode }) {
  const seen = new Set();
  const sections = (Array.isArray(raw?.sections) ? raw.sections : [])
    .filter((s) => s && str(s.title))
    .slice(0, 10)
    .map((s, i) => {
      let id = str(s.id) || `s${i + 1}`;
      if (seen.has(id)) id = `s${i + 1}`;
      seen.add(id);
      return { id, title: str(s.title) };
    });
  if (sections.length < 1) throw new Error("The outline came back without sections.");
  return {
    title: str(title) || str(raw?.title) || "Study pack",
    courseCode: str(courseCode) || str(raw?.courseCode),
    summary: str(raw?.summary),
    sections,
  };
}

/** Fills outline sections with the content a Sections call returned (matched by id, then title, then position). */
export function mergeSections(packSections, wanted, returned) {
  const list = Array.isArray(returned) ? returned : [];
  const byId = new Map(list.map((r) => [str(r?.id), r]));
  const byTitle = new Map(list.map((r) => [str(r?.title).toLowerCase(), r]));
  return packSections.map((s) => {
    const idx = wanted.findIndex((w) => w.id === s.id);
    if (idx < 0) return s;
    const r = byId.get(s.id) || byTitle.get(s.title.toLowerCase()) || list[idx];
    if (!r || !str(r.explanation)) return s; // still pending
    return { id: s.id, title: s.title, explanation: str(r.explanation), keyTerms: cleanKeyTerms(r.keyTerms), workedExample: str(r.workedExample) };
  });
}

const qKey = (q) => str(q.question).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const qWords = (q) => new Set(qKey(q).split(" ").filter((w) => w.length > 2));
function nearDuplicate(a, b) {
  if (qKey(a) === qKey(b)) return true;
  const A = qWords(a);
  const B = qWords(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter) >= 0.85; // Jaccard similarity
}

/**
 * Adds a batch of questions: cleans each one, makes sure its sectionId exists (falls back to the
 * batch's first section), drops near-identical duplicates, and renumbers ids q1..qN.
 */
export function mergeQuestions(existing, returned, sectionIds, fallbackSectionId) {
  const ids = new Set(sectionIds);
  const merged = [...existing];
  (Array.isArray(returned) ? returned : []).forEach((q, i) => {
    const clean = cleanQuestion(q, i, ids, fallbackSectionId);
    if (clean && !merged.some((m) => nearDuplicate(m, clean))) merged.push(clean);
  });
  return merged.map((q, i) => ({ ...q, id: `q${i + 1}` }));
}

// ---------- Share offline: .lightout.json ----------
export function exportPack(pack) {
  const payload = { format: PACK_FORMAT, version: PACK_VERSION, exportedAt: new Date().toISOString(), pack };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const slug = `${pack.courseCode || ""} ${pack.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "pack";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${slug}.lightout.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function readPackFile(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error("That file is too big to be a Lightout pack.");
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't valid JSON. Pick a .lightout.json file.");
  }
  if (data?.format && data.format !== PACK_FORMAT) throw new Error("That JSON file isn't a Lightout pack.");
  const candidate = data?.format ? data.pack : data;
  if (!candidate || typeof candidate !== "object" || !("sections" in candidate) || !("questions" in candidate))
    throw new Error("That JSON file isn't a Lightout pack. Ask your classmate to use Export on their pack.");
  const pack = validatePack(data?.format ? data.pack : data);
  return { ...pack, source: "imported", updatedAt: Date.now() };
}
