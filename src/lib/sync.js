// Anonymous Auth + Firestore sync. Only pack JSON is synced, never uploaded files.
// Path: users/{uid}/packs/{packId}
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { collection, doc, getDocs, setDoc, deleteDoc } from "firebase/firestore";
import { auth, db } from "../firebase.js";
import { local } from "./db.js";

const MAX_DOC_BYTES = 900_000; // Firestore limit is 1 MiB per document; keep headroom.

let uidPromise = null;

/** Resolves to the current uid (signing in anonymously if needed), or null if that isn't possible right now. */
export function ensureUser() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser.uid);
  if (uidPromise) return uidPromise;
  uidPromise = new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, async (user) => {
      stop();
      if (user) return resolve(user.uid);
      if (!navigator.onLine) return resolve(null);
      try {
        const cred = await signInAnonymously(auth);
        resolve(cred.user.uid);
      } catch (e) {
        console.warn("[Lightout] Anonymous sign-in failed; packs stay on this device only.", e?.code || e);
        resolve(null);
      }
    });
  }).finally(() => {
    uidPromise = null;
  });
  return uidPromise;
}

function toDoc(pack) {
  const json = JSON.stringify(pack);
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > MAX_DOC_BYTES) return null;
  return { title: pack.title, courseCode: pack.courseCode || "", updatedAt: pack.updatedAt, json };
}

/** Upload one pack. Returns false (without throwing) when offline, signed out or too big. */
export async function pushPack(pack) {
  if (!navigator.onLine) return false;
  const uid = await ensureUser();
  if (!uid) return false;
  const data = toDoc(pack);
  if (!data) {
    console.warn(`[Lightout] Pack "${pack.title}" is over ~1 MB, so it stays on this device only.`);
    return false;
  }
  try {
    await setDoc(doc(db, "users", uid, "packs", pack.id), data);
    return true;
  } catch (e) {
    console.warn("[Lightout] Pack sync failed", e?.code || e);
    return false;
  }
}

export async function removeRemotePack(id) {
  if (!navigator.onLine || !auth.currentUser) return;
  try {
    await deleteDoc(doc(db, "users", auth.currentUser.uid, "packs", id));
  } catch (e) {
    console.warn("[Lightout] Couldn't delete synced pack", e?.code || e);
  }
}

/**
 * Two-way merge by updatedAt: newer remote packs land in IndexedDB,
 * newer (or local-only) packs are uploaded. Returns { pulled, pushed } or null if it couldn't run.
 */
export async function syncPacks(validate) {
  if (!navigator.onLine) return null;
  const uid = await ensureUser();
  if (!uid) return null;
  let snap;
  try {
    snap = await getDocs(collection(db, "users", uid, "packs"));
  } catch (e) {
    console.warn("[Lightout] Couldn't read synced packs", e?.code || e);
    return null;
  }
  const remote = new Map();
  snap.forEach((d) => {
    try {
      const pack = validate(JSON.parse(d.data().json));
      remote.set(pack.id, pack);
    } catch {
      /* skip malformed remote docs */
    }
  });
  const localPacks = await local.packs.toArray();
  const localById = new Map(localPacks.map((p) => [p.id, p]));
  let pulled = 0;
  let pushed = 0;
  for (const [id, rp] of remote) {
    const lp = localById.get(id);
    if (!lp || (rp.updatedAt || 0) > (lp.updatedAt || 0)) {
      await local.packs.put(rp);
      pulled++;
    }
  }
  for (const lp of localPacks) {
    const rp = remote.get(lp.id);
    if (!rp || (lp.updatedAt || 0) > (rp.updatedAt || 0)) {
      if (await pushPack(lp)) pushed++;
    }
  }
  return { pulled, pushed };
}
