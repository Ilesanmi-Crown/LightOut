import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  Schema,
  AIError,
} from "firebase/ai";
import { ai } from "./firebase.js";

export { InferenceMode, InferenceSource };

const CLOUD_MODEL = import.meta.env.VITE_CLOUD_MODEL || "gemini-3.8-flash";

/** On-device (Gemini Nano) prompt limit is ~9216 tokens; ~20k chars keeps us safely under it. */
export const ON_DEVICE_CHAR_LIMIT = 20000;

/** Must match between availability(), initializeDeviceModel() and inference. */
export const CREATE_OPTIONS = {
  expectedInputs: [
    { type: "text", languages: ["en"] },
    { type: "image" },
  ],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

// ---------- Schemas for structured output ----------
const flashcardSchema = Schema.object({
  properties: {
    cards: Schema.array({
      items: Schema.object({
        properties: {
          front: Schema.string(),
          back: Schema.string(),
        },
      }),
    }),
  },
});

const quizSchema = Schema.object({
  properties: {
    questions: Schema.array({
      items: Schema.object({
        properties: {
          question: Schema.string(),
          options: Schema.array({ items: Schema.string() }),
          answerIndex: Schema.integer(),
          explanation: Schema.string(),
        },
      }),
    }),
  },
});

// ---------- Tasks ----------
export const TASKS = {
  summarize: {
    label: "Summarize",
    json: false,
    instruction:
      "You are a study assistant. Summarize the student's notes into a clear, well-organised summary with short headings and bullet points. Keep every key fact, definition and formula. Use plain text (no markdown tables).",
  },
  explain: {
    label: "Explain simply",
    json: false,
    instruction:
      "You are a friendly tutor. Explain the main ideas in the student's notes in simple language, as if to a 15-year-old. Use short paragraphs, everyday examples (Nigerian context is welcome), and define any jargon.",
  },
  flashcards: {
    label: "Flashcards",
    json: true,
    schema: flashcardSchema,
    instruction:
      "Create 8 to 12 study flashcards from the student's notes. Each card has a short 'front' (a question or term) and a concise 'back' (the answer or definition). Return only JSON matching the schema.",
  },
  quiz: {
    label: "Quiz me",
    json: true,
    schema: quizSchema,
    instruction:
      "Write 5 multiple-choice questions that test understanding of the student's notes. Each question has exactly 4 options, 'answerIndex' is the 0-based index of the correct option, and 'explanation' briefly says why it is correct. Return only JSON matching the schema.",
  },
};

// ---------- Model cache (one instance per task + mode) ----------
const modelCache = new Map();

export function getModel(taskKey, mode) {
  const key = `${taskKey}:${mode}`;
  if (modelCache.has(key)) return modelCache.get(key);

  const task = TASKS[taskKey];
  const generationConfig = task?.json
    ? { responseMimeType: "application/json", responseSchema: task.schema }
    : undefined;
  const promptOptions = task?.json
    ? { responseConstraint: task.schema.toJSON() }
    : undefined;

  const model = getGenerativeModel(ai, {
    mode,
    inCloudParams: { model: CLOUD_MODEL, generationConfig },
    onDeviceParams: { createOptions: CREATE_OPTIONS, promptOptions },
  });
  modelCache.set(key, model);
  return model;
}

// ---------- On-device status ----------
/**
 * Returns "unsupported" | "unavailable" | "downloadable" | "downloading" | "available".
 */
export async function getOnDeviceStatus() {
  if (typeof LanguageModel === "undefined") return "unsupported";
  try {
    // eslint-disable-next-line no-undef
    return await LanguageModel.availability(CREATE_OPTIONS);
  } catch (e) {
    console.warn("LanguageModel.availability failed", e);
    return "unavailable";
  }
}

/** Must be called from a user gesture (button click). */
export async function downloadOfflineBrain(onProgress) {
  const model = getModel("summarize", InferenceMode.PREFER_ON_DEVICE);
  await model.initializeDeviceModel((p) => onProgress?.(p));
}

// ---------- Routing (our own logic; the SDK does not fall back on long prompts) ----------
/**
 * @returns {{ mode?: string, error?: string, reason: string }}
 */
export function chooseRoute({ chars, online }) {
  const long = chars > ON_DEVICE_CHAR_LIMIT;
  if (long && online)
    return {
      mode: InferenceMode.ONLY_IN_CLOUD,
      reason: "Notes are too long for the on-device model, so this went to the cloud.",
    };
  if (long && !online)
    return {
      error: `Your notes are too long to process offline (${chars.toLocaleString()} characters; the offline limit is about ${ON_DEVICE_CHAR_LIMIT.toLocaleString()}). Try a smaller chunk, or wait until you're back online.`,
      reason: "long+offline",
    };
  if (online)
    return {
      mode: InferenceMode.PREFER_ON_DEVICE,
      reason: "Tries your device first, then falls back to the cloud.",
    };
  return { mode: InferenceMode.ONLY_ON_DEVICE, reason: "You're offline, so this runs on your device only." };
}

// ---------- Run a task ----------
function buildPrompt(taskKey, notes, image) {
  const task = TASKS[taskKey];
  const text =
    `${task.instruction}\n\n` +
    (notes.trim()
      ? `STUDENT'S NOTES:\n"""\n${notes.trim()}\n"""`
      : "The student's notes are in the attached photo.") +
    (image && notes.trim() ? "\n\nAlso use the attached photo of their notes." : "");
  const parts = [{ text }];
  if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
  return parts;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Some models wrap JSON in ``` fences; strip and retry.
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("The AI returned something that wasn't valid JSON. Please try again.");
  }
}

export async function runTask({ taskKey, notes, image, mode }) {
  const model = getModel(taskKey, mode);
  const result = await model.generateContent(buildPrompt(taskKey, notes, image));
  const response = result.response;
  const text = response.text();
  const source = response.inferenceSource ?? (mode === InferenceMode.ONLY_IN_CLOUD ? InferenceSource.IN_CLOUD : undefined);
  const task = TASKS[taskKey];
  const data = task.json ? normalise(taskKey, parseJson(text)) : text;
  return { data, source };
}

function normalise(taskKey, obj) {
  if (taskKey === "flashcards") {
    const cards = (obj?.cards || []).filter((c) => c?.front && c?.back);
    if (!cards.length) throw new Error("No flashcards came back. Try adding more detail to your notes.");
    return { cards };
  }
  const questions = (obj?.questions || [])
    .filter((q) => q?.question && Array.isArray(q.options) && q.options.length >= 2)
    .map((q) => ({
      ...q,
      options: q.options.slice(0, 4),
      answerIndex: Math.min(Math.max(0, Number(q.answerIndex) || 0), Math.min(q.options.length, 4) - 1),
    }));
  if (!questions.length) throw new Error("No quiz questions came back. Try adding more detail to your notes.");
  return { questions };
}

// ---------- Friendly errors ----------
export function friendlyError(err, { online }) {
  const msg = String(err?.message || err || "");
  const code = err instanceof AIError ? err.code : err?.code;
  if (!online) {
    if (/on-device model is not available|not available in this environment|API_NOT_ENABLED/i.test(msg) || code === "api-not-enabled" || code === "unsupported")
      return "You're offline and the offline brain isn't ready on this device. Reconnect and tap \"Download the offline brain\" first.";
    return `Offline AI failed: ${msg || "unknown error"}. Try a shorter chunk of notes.`;
  }
  if (/app.?check|appcheck|401|403|PERMISSION_DENIED/i.test(msg))
    return "The cloud rejected this request (App Check). If you're developing locally, register your App Check debug token in the Firebase Console.";
  if (/quota|429|RESOURCE_EXHAUSTED/i.test(msg)) return "The cloud AI is busy or over quota. Wait a minute and try again.";
  if (/fetch|network|Failed to fetch|ERR_/i.test(msg)) return "Couldn't reach the cloud. Your data may have dropped; try again, or use offline mode.";
  if (/too large|token|exceed/i.test(msg)) return "That was too much for the model. Try a smaller chunk of notes.";
  return msg || "Something went wrong. Please try again.";
}
