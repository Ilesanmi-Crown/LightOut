// AI result cache for Quick tools and pack Q&A, keyed by SHA-256 of
// (task + input text + attached file hashes + cloud model name). Capped at ~500 entries, oldest evicted.
import { local } from "./db.js";
import { sha256 } from "./hash.js";
import { getConfig } from "./config.js";

export const ANSWER_CACHE_MAX = 500;

export function answerKey({ task, text, fileHashes = [] }) {
  return sha256(JSON.stringify({ task, text, files: [...fileHashes].sort(), model: getConfig().cloud_model_name }));
}

export async function getAnswer(key) {
  try {
    return (await local.answers.get(key)) || null;
  } catch {
    return null;
  }
}

export async function putAnswer(key, { task, data, source, ms }) {
  try {
    await local.answers.put({ key, task, data, source, ms, at: Date.now() });
    const count = await local.answers.count();
    if (count > ANSWER_CACHE_MAX) {
      const old = await local.answers.orderBy("at").limit(count - ANSWER_CACHE_MAX).primaryKeys();
      await local.answers.bulkDelete(old);
    }
  } catch (e) {
    console.warn("[Lightout] Couldn't cache answer", e);
  }
}

/** "Clear saved answers & file cache" (keeps packs, progress and settings). */
export async function clearCaches() {
  await Promise.all([local.answers.clear(), local.files.clear()]);
}
