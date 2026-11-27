import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  Schema,
} from "firebase/ai";
import { ai } from "./firebase.js";
import { getConfig } from "./lib/config.js";
import { addSavings } from "./lib/savings.js";
import { formatRawError, setLastAIError } from "./lib/diagnostics.js";

export { InferenceMode, InferenceSource };

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

// ---------- Study Pack schemas & tasks ----------
export const packSchema = Schema.object({
  properties: {
    title: Schema.string(),
    courseCode: Schema.string(),
    summary: Schema.string(),
    sections: Schema.array({
      items: Schema.object({
        properties: {
          id: Schema.string(),
          title: Schema.string(),
          explanation: Schema.string(),
          keyTerms: Schema.array({
            items: Schema.object({ properties: { term: Schema.string(), definition: Schema.string() } }),
          }),
          workedExample: Schema.string(),
        },
      }),
    }),
    questions: Schema.array({
      items: Schema.object({
        properties: {
          id: Schema.string(),
          sectionId: Schema.string(),
          type: Schema.enumString({ enum: ["mcq", "short"] }),
          question: Schema.string(),
          options: Schema.array({ items: Schema.string() }),
          answerIndex: Schema.integer(),
          modelAnswer: Schema.string(),
          explanation: Schema.string(),
        },
        optionalProperties: ["options", "answerIndex"],
      }),
    }),
  },
});

const markSchema = Schema.object({
  properties: {
    score: Schema.integer(),
    verdict: Schema.enumString({ enum: ["correct", "partly", "wrong"] }),
    feedback: Schema.string(),
  },
});

/** Tasks used by Study Packs (not shown as Quick Tools buttons). */
export const PACK_TASKS = {
  buildPack: { label: "Build pack", json: true, schema: packSchema, maxOutputTokens: 32768 },
  mark: { label: "Mark answer", json: true, schema: markSchema },
  ask: { label: "Ask about this pack", json: false },
};

const ALL_TASKS = { ...TASKS, ...PACK_TASKS };

// ---------- Model cache (one instance per task + mode + cloud model) ----------
const modelCache = new Map();

export function getModel(taskKey, mode) {
  const cloudModel = getConfig().cloud_model_name;
  const key = `${taskKey}:${mode}:${cloudModel}`;
  if (modelCache.has(key)) return modelCache.get(key);

  const task = ALL_TASKS[taskKey];
  const generationConfig = task?.json
    ? {
        responseMimeType: "application/json",
        responseSchema: task.schema,
        ...(task.maxOutputTokens ? { maxOutputTokens: task.maxOutputTokens } : {}),
      }
    : undefined;
  const promptOptions = task?.json
    ? { responseConstraint: task.schema.toJSON() }
    : undefined;

  const model = getGenerativeModel(ai, {
    mode,
    inCloudParams: { model: cloudModel, generationConfig },
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

/**
 * Runs any prompt through Firebase AI Logic. Text tasks stream (onText gets the growing text);
 * JSON tasks don't, because half a JSON object can't be rendered.
 * `source` comes from the final aggregated response; if the SDK doesn't report it,
 * we fall back to what the routing mode guarantees.
 * Every on-device call adds its request + response bytes to the savings counter.
 */
export async function runPrompt(args) {
  try {
    return await runPromptInner(args);
  } catch (err) {
    setLastAIError(err, { task: args.taskKey, mode: args.mode, online: navigator.onLine });
    throw err;
  }
}

async function runPromptInner({ taskKey, parts, mode, onText }) {
  const model = getModel(taskKey, mode);
  const task = ALL_TASKS[taskKey];
  let response;
  let text = "";

  if (!task.json) {
    const result = await model.generateContentStream(parts);
    for await (const chunk of result.stream) {
      let piece = "";
      try {
        piece = chunk.text();
      } catch {
        /* chunk without text (e.g. safety metadata) */
      }
      if (piece) {
        text += piece;
        onText?.(text);
      }
    }
    response = await result.response;
  } else {
    response = (await model.generateContent(parts)).response;
    text = response.text();
  }

  const source = response?.inferenceSource ?? fallbackSource(mode);
  if (source === InferenceSource.ON_DEVICE) {
    addSavings({ requestBytes: partsBytes(parts), responseBytes: utf8Bytes(text) }).catch(() => {});
  }
  return { text, source };
}

export async function runTask({ taskKey, notes, image, mode, onText }) {
  const { text, source } = await runPrompt({ taskKey, parts: buildPrompt(taskKey, notes, image), mode, onText });
  const data = TASKS[taskKey].json ? normalise(taskKey, parseJson(text)) : text;
  return { data, source };
}

const encoder = new TextEncoder();
function utf8Bytes(str) {
  return encoder.encode(str || "").length;
}
/** What the same request would have cost on the wire as a cloud call (text + base64 attachments). */
function partsBytes(parts) {
  return parts.reduce((n, p) => n + (p.text ? utf8Bytes(p.text) : 0) + (p.inlineData?.data?.length || 0), 0);
}

/**
 * Picks the inference mode with the existing routing rules, and when offline confirms the
 * on-device model is actually ready (otherwise ONLY_ON_DEVICE would try to download it and hang).
 * Returns { mode, reason } or { error }.
 */
export async function prepareRoute({ chars, online }) {
  const route = chooseRoute({ chars, online });
  if (route.error || online) return route;
  const s = await getOnDeviceStatus();
  if (s === "available") return route;
  return {
    error:
      s === "unsupported" || s === "unavailable"
        ? "You're offline and this browser can't run AI on-device. Reconnect to use the cloud, or open the app in Chrome desktop 139+."
        : 'You\'re offline and the offline brain isn\'t downloaded yet. Reconnect, then tap "Download the offline brain".',
    status: s,
  };
}

export { parseJson };

function fallbackSource(mode) {
  if (mode === InferenceMode.ONLY_IN_CLOUD) return InferenceSource.IN_CLOUD;
  if (mode === InferenceMode.ONLY_ON_DEVICE) return InferenceSource.ON_DEVICE;
  return undefined; // PREFER_ON_DEVICE could have gone either way: don't guess.
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
/**
 * Error text for the UI. Cloud/SDK errors are shown RAW (name, code, message, and
 * customErrorData status/statusText/errorDetails) instead of being guessed at.
 * Only the offline on-device case gets a short hint in front of the raw error.
 */
export function friendlyError(err, { online }) {
  const raw = formatRawError(err);
  if (!online) {
    const msg = String(err?.message || "");
    if (/on-device model is not available|not available in this environment/i.test(msg) || ["api-not-enabled", "unsupported"].includes(err?.code))
      return `You're offline and the offline brain isn't ready on this device. Reconnect and tap "Download the offline brain" first.\n\n${raw}`;
  }
  return raw;
}
