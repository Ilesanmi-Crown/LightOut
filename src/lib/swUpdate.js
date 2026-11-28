// Service worker registration + "new version ready" state for the update toast.
import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";

let updateReady = false;
const listeners = new Set();

export function startServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  registerSW({
    immediate: true,
    // autoUpdate mode: the new version is already active for the next load. Instead of
    // reloading under the student's feet, show a dismissible toast.
    onNeedReload() {
      updateReady = true;
      listeners.forEach((fn) => fn(true));
    },
  });
}

export function useUpdateReady() {
  const [ready, setReady] = useState(updateReady);
  useEffect(() => {
    listeners.add(setReady);
    return () => listeners.delete(setReady);
  }, []);
  return ready;
}
