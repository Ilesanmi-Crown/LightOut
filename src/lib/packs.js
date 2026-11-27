// Study Pack: build (cloud), validate, import/export.
import { runPrompt, parseJson, InferenceMode } from "../ai.js";
import { getConfig } from "./config.js";

export const PACK_FORMAT = "lightout-pack";
export const PACK_VERSION = 1;

const str = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * Validates and normalises a pack from any source (model output, import, Firestore).
 * Throws a readable Error when the shape is wrong. Returns a clean pack.
 */
export function validatePack(input) {
  const p = input && typeof input === "object" ? input : null;
  if (!p) throw new Error("That isn't a Lightout pack (no data).");
  const title = str(p.title);
  if (!title) throw new Error("The pack has no title.");
  if (!Array.isArray(p.sections) || p.sections.length === 0) throw new Error("The pack has no sections.");
  if (!Array.isArray(p.questions)) throw new Error("The pack has no question bank.");

  const seen = new Set();
  const sections = p.sections
    .filter((s) => s && str(s.title) && str(s.explanation))
    .map((s, i) => {
      let id = str(s.id) || `s${i + 1}`;
      if (seen.has(id)) id = `${id}-${i + 1}`;
      seen.add(id);
      return {
        id,
        title: str(s.title),
        explanation: str(s.explanation),
        keyTerms: (Array.isArray(s.keyTerms) ? s.keyTerms : [])
          .filter((k) => k && str(k.term) && str(k.definition))
          .map((k) => ({ term: str(k.term), definition: str(k.definition) })),
        workedExample: str(s.workedExample),
      };
    });
  if (!sections.length) throw new Error("None of the pack's sections are complete.");
  const sectionIds = new Set(sections.map((s) => s.id));

  const qSeen = new Set();
  const questions = p.questions
    .map((q, i) => {
      if (!q || !str(q.question)) return null;
      let id = str(q.id) || `q${i + 1}`;
      if (qSeen.has(id)) id = `${id}-${i + 1}`;
      const sectionId = sectionIds.has(str(q.sectionId)) ? str(q.sectionId) : sections[0].id;
      const base = { id, sectionId, question: str(q.question), modelAnswer: str(q.modelAnswer), explanation: str(q.explanation) };
      if (q.type === "mcq") {
        const options = (Array.isArray(q.options) ? q.options : []).map(str).filter(Boolean).slice(0, 6);
        const answerIndex = Number(q.answerIndex);
        if (options.length < 2 || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) return null;
        qSeen.add(id);
        return { ...base, type: "mcq", options, answerIndex, modelAnswer: base.modelAnswer || options[answerIndex] };
      }
      if (q.type === "short" && base.modelAnswer) {
        qSeen.add(id);
        return { ...base, type: "short" };
      }
      return null;
    })
    .filter(Boolean);
  if (!questions.length) throw new Error("The pack's question bank is empty.");

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
  };
}

function packInstruction({ title, courseCode, count }) {
  return `You are an expert Nigerian university tutor building an offline "Study Pack" from a student's course materials.
Course: ${courseCode || "(infer from the materials)"}. Pack title: ${title || "(infer a short, clear title)"}.

Return ONLY JSON matching the schema:
- "title" and "courseCode" (use the ones above if given).
- "summary": 3-5 sentences on what the pack covers.
- "sections": 5 to 10 sections that follow the materials' structure. Each has a short unique "id" (s1, s2, ...), a "title",
  an "explanation" (2-4 short paragraphs a first-year student can follow), 3-6 "keyTerms" with clear definitions,
  and a "workedExample" (a step-by-step example or calculation; use local Nigerian examples such as Lagos markets,
  fuel, bread, danfo fares or naira prices where natural).
- "questions": at least ${count} questions covering every section, each with a unique "id" (q1, q2, ...) and the
  "sectionId" it tests. Mix about 70% "mcq" and 30% "short".
  - mcq: exactly 4 "options", "answerIndex" is the 0-based index of the correct option, plausible distractors.
  - short: no options; "modelAnswer" is a complete 1-3 sentence answer a marker can compare against.
  - Every question has a "modelAnswer" and an "explanation" of why the answer is right.
Use simple language. Only use facts from the materials (you may add standard textbook context to explain them).`;
}

/** Assemble the multimodal prompt: instructions, pasted text, extracted text, then PDFs/photos as inlineData. */
export function buildPackParts({ title, courseCode, pasted, items }) {
  const count = getConfig().pack_question_count;
  const parts = [{ text: packInstruction({ title, courseCode, count }) }];
  if (pasted.trim()) parts.push({ text: `PASTED NOTES:\n"""\n${pasted.trim()}\n"""` });
  for (const it of items) {
    if (it.text) parts.push({ text: `FILE "${it.name}":\n"""\n${it.text}\n"""` });
  }
  for (const it of items) {
    if (it.base64) {
      parts.push({ text: `Attached file: "${it.name}"` });
      parts.push({ inlineData: { mimeType: it.mimeType, data: it.base64 } });
    }
  }
  return parts;
}

/** Cloud-only: PDFs aren't supported on-device, and building a pack is a heavy one-time job. */
export async function buildPack({ title, courseCode, pasted, items }) {
  const parts = buildPackParts({ title, courseCode, pasted, items });
  const { text, source } = await runPrompt({ taskKey: "buildPack", parts, mode: InferenceMode.ONLY_IN_CLOUD });
  const raw = parseJson(text);
  const now = Date.now();
  const pack = validatePack({
    ...raw,
    id: crypto.randomUUID(),
    title: title.trim() || raw.title,
    courseCode: courseCode.trim() || raw.courseCode,
    source: "built",
    createdAt: now,
    updatedAt: now,
  });
  return { pack, source };
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
  const pack = validatePack(data?.format ? data.pack : data);
  return { ...pack, source: "imported", updatedAt: Date.now() };
}
