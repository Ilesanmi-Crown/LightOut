// Background preparation queue for New Pack uploads.
// Jobs start the moment a file is added, run at most 3 at a time, and can be cancelled.
import { prepareFile, isCancelled, detectKind } from "./ingest.js";
import { hashFile } from "./hash.js";
import { getPreparedFile, putPreparedFile } from "./fileCache.js";

/** Prepared result for a file: from the cache (by content hash) when possible, otherwise prepared and cached. */
async function prepareWithCache(file, signal) {
  let hash = null;
  try {
    hash = await hashFile(file);
  } catch {
    /* hashing failed (e.g. unreadable file): prepare without the cache */
  }
  if (signal.aborted) throw Object.assign(new Error("cancelled"), { name: "CancelledError" });
  if (hash) {
    const hit = await getPreparedFile(hash);
    if (hit && hit.kind === detectKind(file)) {
      const d = hit.payload.inlineData;
      return {
        kind: hit.kind,
        payload: hit.payload,
        payloadBytes: hit.payloadBytes,
        previewUrl: hit.kind === "image" && d ? `data:${d.mimeType};base64,${d.data}` : undefined,
        hash,
        fromCache: true,
      };
    }
  }
  const res = await prepareFile(file, { signal });
  if (hash) putPreparedFile(hash, res);
  return { ...res, hash, fromCache: false };
}

const MAX_PARALLEL = 3;

/**
 * @param {(id: string, patch: object) => void} onUpdate  called with status changes:
 *   { status: "preparing" } -> { status: "ready", payload, payloadBytes, previewUrl } | { status: "error", error }
 */
export function createPrepareQueue(onUpdate) {
  const jobs = new Map(); // id -> { file, controller, done: Promise }
  const results = new Map(); // id -> { status: "ready", payload, payloadBytes, previewUrl } | { status: "error", error }
  const waiting = [];
  let running = 0;

  function pump() {
    while (running < MAX_PARALLEL && waiting.length) {
      const id = waiting.shift();
      const job = jobs.get(id);
      if (!job || job.controller.signal.aborted) continue;
      running++;
      prepareWithCache(job.file, job.controller.signal)
        .then((res) => {
          if (job.controller.signal.aborted) return;
          const r = { status: "ready", ...res };
          results.set(id, r);
          onUpdate(id, r);
        })
        .catch((e) => {
          if (isCancelled(e) || job.controller.signal.aborted) return;
          const r = { status: "error", error: e?.message || "Couldn't read this file." };
          results.set(id, r);
          onUpdate(id, r);
        })
        .finally(() => {
          running--;
          job.resolve();
          pump();
        });
    }
  }

  return {
    add(id, file) {
      const controller = new AbortController();
      let resolve;
      const done = new Promise((r) => (resolve = r));
      jobs.set(id, { file, controller, done, resolve });
      waiting.push(id);
      pump();
    },
    /** Cancels a job (queued or running) and forgets it. */
    remove(id) {
      const job = jobs.get(id);
      if (!job) return;
      job.controller.abort();
      jobs.delete(id);
      results.delete(id); // discard any finished result
      const i = waiting.indexOf(id);
      if (i >= 0) {
        waiting.splice(i, 1);
        job.resolve();
      }
    },
    /** The finished result for a file (kept in memory until the file is removed), or undefined. */
    result(id) {
      return results.get(id);
    },
    /** Resolves when every job still in the queue has finished (ready or error). */
    whenIdle() {
      return Promise.all([...jobs.values()].map((j) => j.done));
    },
    cancelAll() {
      for (const id of [...jobs.keys()]) this.remove(id);
    },
  };
}
