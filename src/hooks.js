import { useEffect, useRef, useState } from "react";

export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Shows "offline" while offline, then "back" for 3 seconds after reconnecting. */
export function useConnectionBanner(online) {
  const [banner, setBanner] = useState(online ? null : "offline");
  const wasOffline = useRef(!online);
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      setBanner("offline");
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setBanner("back");
    const t = setTimeout(() => setBanner(null), 3000);
    return () => clearTimeout(t);
  }, [online]);
  return banner;
}

/** Ticks once a second while `active`, returning elapsed seconds. */
export function useElapsed(active) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!active) return;
    setSecs(0);
    const start = performance.now();
    const t = setInterval(() => setSecs(Math.floor((performance.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [active]);
  return secs;
}
