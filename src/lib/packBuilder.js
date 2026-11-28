// Parallel pack building (all ONLY_IN_CLOUD through Firebase AI Logic):
//   Stage 1  outline  { title, courseCode, summary, sections: [{ id, title }] }
//   Stage 2  in parallel: sections A, sections B, questions A, questions B (each retried once)
// The pack is saved after Stage 1 and updated as each part arrives; screens subscribe via onPackChange().
import { runPrompt, parseJson, InferenceMode, isThinkingConfigError, disableThinkingConfig, thinkingStatus, isOverloadError } from "../ai.js";
import { local, getPack, putPack } from "./db.js";
import { pushPack } from "./sync.js";
import { getConfig } from "./config.js";
import { getPreparedFile } from "./fileCache.js";
import {
  buildMaterialParts,
  transcriptMaterial,
  outlinePrompt,
  sectionsPrompt,
  questionsPrompt,
  splitHalves,
  splitQuestionCount,
  normaliseOutline,
  mergeSections,
  mergeQuestions,
  validatePack,
} from "./packs.js";

export const PARTS = ["sectionsA", "sectionsB", "questionsA", "questionsB"];
export const MAX_PARALLEL_CLOUD_CALLS = 2; // fewer simultaneous calls = fewer 429/500s

const partsBytes = (parts) => parts.reduce((n, p) => n + (p.text ? new TextEncoder().encode(p.text).length : 0) + (p.inlineData?.data?.length || 0), 0);

/** Runs async jobs with at most `limit` in flight; the rest wait in order. */
async function runLimited(jobs, limit) {
  const results = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await jobs[i]() };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

// ---------- live updates ----------
const listeners = new Map(); // packId -> Set(fn)
const active = new Set(); // packIds with a build running in this tab

export function onPackChange(packId, fn) {
  if (!listeners.has(packId)) listeners.set(packId, new Set());
  listeners.get(packId).add(fn);
  return () => listeners.get(packId)?.delete(fn);
}
const emit = (pack) => listeners.get(pack.id)?.forEach((fn) => fn(pack));
export const isBuilding = (packId) => active.has(packId);

// ---------- timings (?debug=1 "Last pack build timings") ----------
const timingListeners = new Set();
export async function getLastBuildTimings() {
  try {
    return (await local.meta.get("lastBuildTimings"))?.value || null;
  } catch {
    return null;
  }
}
export function onBuildTimings(fn) {
  timingListeners.add(fn);
  return () => timingListeners.delete(fn);
}
async function saveTimings(t) {
  try {
    await local.meta.put({ key: "lastBuildTimings", value: t });
  } catch {
    /* ignore */
  }
  timingListeners.forEach((fn) => fn(t));
}

// ---------- one cloud JSON call (minimal thinking; falls back if the model rejects it) ----------
// runPrompt already retries 429/500/503 (2 s, 5 s, 10 s) and then tries the fallback model once.
async function cloudJson(taskKey, parts, label) {
  try {
    const r = await runPrompt({ taskKey, parts, mode: InferenceMode.ONLY_IN_CLOUD, label, countSavings: false });
    return { data: parseJson(r.text), source: r.source, model: r.model };
  } catch (e) {
    if (!isThinkingConfigError(e)) throw e;
    disableThinkingConfig(); // model/SDK doesn't take the thinking setting: carry on without it
    const r = await runPrompt({ taskKey, parts, mode: InferenceMode.ONLY_IN_CLOUD, label, countSavings: false });
    return { data: parseJson(r.text), source: r.source, model: r.model };
  }
}

// ---------- serialised pack updates (parallel results must not overwrite each other) ----------
const chains = new Map();
function updatePack(packId, fn) {
  const prev = chains.get(packId) || Promise.resolve();
  const next = prev.then(async () => {
    const cur = await getPack(packId);
    if (!cur) return null; // deleted meanwhile
    const updated = { ...fn(cur), updatedAt: Date.now() };
    await putPack(updated);
    emit(updated);
    return updated;
  });
  chains.set(packId, next.catch(() => {}));
  return next;
}

// ---------- Stage 2 ----------
async function runParts({ packId, material, outline, parts, timings, t0 }) {
  const { A: secA, B: secB } = splitHalves(outline.sections);
  const counts = splitQuestionCount();
  const allIds = outline.sections.map((s) => s.id);
  const specs = {
    sectionsA: { task: "packSections", sections: secA, prompt: () => sectionsPrompt({ outline, sections: secA }) },
    sectionsB: { task: "packSections", sections: secB, prompt: () => sectionsPrompt({ outline, sections: secB }) },
    questionsA: { task: "packQuestions", sections: secA, prompt: () => questionsPrompt({ outline, sections: secA, count: counts.A }) },
    questionsB: { task: "packQuestions", sections: secB, prompt: () => questionsPrompt({ outline, sections: secB, count: counts.B }) },
  };
  const stage2Start = performance.now();
  active.add(packId);

  const runOne = async (key) => {
    const spec = specs[key];
    const call = { attempts: 0, ok: false };
    timings.calls[key] = call;
    if (!spec.sections.length) {
      // e.g. a 1-section outline: nothing to do for the B half
      await updatePack(packId, (p) => ({ ...p, build: { ...p.build, parts: { ...p.build.parts, [key]: "done" } } }));
      call.ok = true;
      call.ms = 0;
      return;
    }
    const start = performance.now();
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      call.attempts = attempt;
      try {
        const { data, model } = await cloudJson(spec.task, [{ text: spec.prompt() }, ...material], `pack:${key}`);
        call.model = model;
        await updatePack(packId, (p) => {
          const next = { ...p, build: { ...p.build, parts: { ...p.build.parts, [key]: "done" } } };
          if (spec.task === "packSections") {
            next.sections = mergeSections(p.sections, spec.sections, data?.sections);
          } else {
            next.questions = mergeQuestions(p.questions, data?.questions, allIds, spec.sections[0].id);
          }
          return next;
        });
        call.ok = true;
        call.ms = Math.round(performance.now() - start);
        if (spec.task === "packSections" && timings.firstSectionMs == null) timings.firstSectionMs = Math.round(performance.now() - t0);
        return;
      } catch (e) {
        lastErr = e;
        console.warn(`[Lightout] Pack part ${key} failed (attempt ${attempt})`, e);
        if (isOverloadError(e)) break; // runPrompt already retried + tried the fallback model
      }
    }
    call.ms = Math.round(performance.now() - start);
    call.error = String(lastErr?.message || lastErr);
    await updatePack(packId, (p) => ({ ...p, build: { ...p.build, parts: { ...p.build.parts, [key]: "failed" } } }));
    throw lastErr;
  };

  timings.uploadBytesPerCall = partsBytes(material);
  await runLimited(parts.map((key) => () => runOne(key)), MAX_PARALLEL_CLOUD_CALLS);
  active.delete(packId);
  timings.stage2Ms = Math.round(performance.now() - stage2Start);

  // Finalise: a complete pack drops the build info (exact pack schema); a partial one keeps it for "Finish this pack".
  const final = await updatePack(packId, (p) => {
    const sectionsMissing = p.sections.some((s) => s.pending);
    const allDone = PARTS.every((k) => p.build.parts[k] === "done") && !sectionsMissing;
    if (allDone) {
      const { build, ...rest } = p;
      return validatePack(rest);
    }
    return { ...p, build: { ...p.build, status: "partial" } };
  });
  timings.totalMs = Math.round(performance.now() - t0);
  timings.complete = Boolean(final && !final.build);
  saveTimings(timings);
  if (final) pushPack(final);
  return final;
}

/**
 * Starts a parallel build. Resolves once Stage 1 (the outline) is saved, with { pack, done }:
 * `done` settles when every Stage 2 part has finished (or failed after one retry).
 */
export async function startBuild({ title, courseCode, pasted, items, t0 = performance.now(), filesWaitMs = 0 }) {
  const material = buildMaterialParts({ pasted, items }); // prepared payloads, reused by every call
  const timings = {
    at: new Date().toISOString(),
    model: getConfig().cloud_model_name,
    thinking: thinkingStatus(),
    questionTarget: splitQuestionCount().total,
    filesWaitMs: Math.round(filesWaitMs),
    calls: {},
  };
  const s1 = performance.now();
  const hasFiles = material.some((p) => p.inlineData);
  let data;
  let stage2Material = material;
  try {
    // With photos/PDFs, the outline call also transcribes them so Stage 2 gets text instead of re-uploads.
    ({ data } = await cloudJson("packOutline", [{ text: outlinePrompt({ title, courseCode, wantTranscript: hasFiles }) }, ...material], "pack:outline"));
  } catch (e) {
    if (!hasFiles || isOverloadError(e) || !/format|JSON/i.test(String(e?.message))) throw e;
    // A very long transcript can overflow the output; fall back to an outline without it.
    ({ data } = await cloudJson("packOutline", [{ text: outlinePrompt({ title, courseCode }) }, ...material], "pack:outline"));
  }
  const transcript = typeof data?.transcript === "string" ? data.transcript.trim() : "";
  if (hasFiles && transcript.length > 40) stage2Material = transcriptMaterial(material, transcript);
  timings.stage1Ms = Math.round(performance.now() - s1);
  timings.thinking = thinkingStatus(); // may have changed if the model rejected it
  timings.transcriptChars = transcript.length;
  timings.originalUploadBytes = partsBytes(material);
  const outline = normaliseOutline(data, { title, courseCode });

  const now = Date.now();
  const pack = {
    id: crypto.randomUUID(),
    title: outline.title,
    courseCode: outline.courseCode,
    summary: outline.summary,
    sections: outline.sections.map((s) => ({ ...s, explanation: "", keyTerms: [], workedExample: "", pending: true })),
    questions: [],
    source: "built",
    createdAt: now,
    updatedAt: now,
    build: { status: "building", parts: Object.fromEntries(PARTS.map((k) => [k, "pending"])) },
  };
  await putPack(pack); // saved right after Stage 1, so nothing is lost if the tab closes
  await local.buildInputs.put({
    packId: pack.id,
    title,
    courseCode,
    pasted,
    files: items.filter((it) => it.hash).map((it) => ({ name: it.name, hash: it.hash, kind: it.payload?.text ? "text" : "file" })),
    transcript: stage2Material === material ? "" : transcript, // lets "Try again" resume without the files
  });
  timings.outlineSavedMs = Math.round(performance.now() - t0);
  const done = runParts({ packId: pack.id, material: stage2Material, outline, parts: PARTS, timings, t0 });
  return { pack, done };
}

/** Parts that still need running: failed ones, or pending ones whose build isn't running any more (tab was closed). */
export function missingParts(pack) {
  if (!pack?.build) return [];
  return PARTS.filter((k) => pack.build.parts?.[k] === "failed" || (pack.build.parts?.[k] !== "done" && !isBuilding(pack.id)));
}

/** "Finish this pack": re-runs only the missing parts with the original material (from the prepared-file cache). */
export async function finishPack(packId) {
  const pack = await getPack(packId);
  const parts = missingParts(pack);
  if (!parts.length) return pack;
  const inputs = await local.buildInputs.get(packId);
  if (!inputs) throw new Error("This pack's original material isn't on this device. Build it again from your files.");
  // With a saved transcript, photos/PDFs aren't needed (or re-uploaded) at all: only text files are reloaded.
  const items = [];
  for (const f of inputs.files) {
    if (inputs.transcript && f.kind === "file") continue;
    const hit = await getPreparedFile(f.hash);
    if (!hit) throw new Error(`"${f.name}" isn't saved anymore. Build the pack again from your files.`);
    items.push({ name: f.name, payload: hit.payload });
  }
  const full = buildMaterialParts({ pasted: inputs.pasted || "", items });
  const material = inputs.transcript ? transcriptMaterial(full, inputs.transcript) : full;
  const outline = { title: pack.title, courseCode: pack.courseCode, summary: pack.summary, sections: pack.sections.map(({ id, title }) => ({ id, title })) };
  await updatePack(packId, (p) => ({
    ...p,
    build: { ...p.build, status: "building", parts: { ...p.build.parts, ...Object.fromEntries(parts.map((k) => [k, "pending"])) } },
  }));
  const timings = { at: new Date().toISOString(), model: getConfig().cloud_model_name, thinking: thinkingStatus(), finishing: parts, calls: {} };
  return runParts({ packId, material, outline, parts, timings, t0: performance.now() });
}
