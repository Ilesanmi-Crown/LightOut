// IndexedDB (via Dexie) is the source of truth offline.
import Dexie from "dexie";

export const local = new Dexie("lightout");

local.version(1).stores({
  // pack: { id, title, courseCode, summary, sections, questions, createdAt, updatedAt, source }
  packs: "id, updatedAt, title",
  // per-question stats: { key: `${packId}:${qid}`, packId, qid, attempts, correct, wrongStreak, lastResult, lastSeen }
  qstats: "key, packId",
  // key/value: { key: "savings", ... }
  meta: "key",
});

// v2: log of every AI call for the device-vs-cloud comparison.
// call: { id, at, source: "device" | "cloud" | "unknown", task, mode, ms, requestBytes, responseBytes }
local.version(2).stores({
  calls: "++id, at, source",
});

export async function listPacks() {
  return local.packs.orderBy("updatedAt").reverse().toArray();
}

export const getPack = (id) => local.packs.get(id);
export const putPack = (pack) => local.packs.put(pack);

export async function deletePack(id) {
  await local.transaction("rw", local.packs, local.qstats, async () => {
    await local.packs.delete(id);
    await local.qstats.where("packId").equals(id).delete();
  });
}

export async function getQuestionStats(packId) {
  const rows = await local.qstats.where("packId").equals(packId).toArray();
  return Object.fromEntries(rows.map((r) => [r.qid, r]));
}

export async function recordAnswer(packId, qid, correct) {
  const key = `${packId}:${qid}`;
  await local.transaction("rw", local.qstats, async () => {
    const prev = (await local.qstats.get(key)) || { key, packId, qid, attempts: 0, correct: 0, wrongStreak: 0 };
    await local.qstats.put({
      ...prev,
      attempts: prev.attempts + 1,
      correct: prev.correct + (correct ? 1 : 0),
      wrongStreak: correct ? 0 : prev.wrongStreak + 1,
      lastResult: correct ? "right" : "wrong",
      lastSeen: Date.now(),
    });
  });
}

export async function resetQuestionStats(packId) {
  await local.qstats.where("packId").equals(packId).delete();
}
