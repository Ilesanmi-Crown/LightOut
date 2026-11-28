// "Delete all my data": everything Lightout stored for this student, on this device and in the synced copy.
import { local } from "./db.js";
import { removeRemotePack } from "./sync.js";

export async function deleteAllData() {
  const ids = await local.packs.toCollection().primaryKeys();
  if (navigator.onLine) await Promise.all(ids.map((id) => removeRemotePack(id)));
  await Promise.all(local.tables.map((t) => t.clear()));
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("lightout-")) localStorage.removeItem(k);
  } catch {
    /* storage blocked */
  }
}
