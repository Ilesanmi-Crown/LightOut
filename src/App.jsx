import { useCallback, useEffect, useState } from "react";
import { getOnDeviceStatus } from "./ai.js";
import { useOnline, useConnectionBanner } from "./hooks.js";
import { refreshConfig } from "./lib/config.js";
import { syncPacks } from "./lib/sync.js";
import { validatePack } from "./lib/packs.js";
import OfflineBrainPanel from "./components/OfflineBrainPanel.jsx";
import DebugPanel from "./components/DebugPanel.jsx";
import { isDebug } from "./lib/diagnostics.js";

const DEBUG = isDebug();
import QuickTools from "./screens/QuickTools.jsx";
import NewPack from "./screens/NewPack.jsx";
import PackLibrary from "./screens/PackLibrary.jsx";
import PackView from "./screens/PackView.jsx";

const BRAIN_SHORT = {
  checking: "Checking",
  unsupported: "Not supported",
  unavailable: "Unavailable",
  downloadable: "Not downloaded",
  downloading: "Downloading",
  available: "Ready",
};

// ---------- tiny hash router: #/packs, #/new, #/tools, #/pack/<id> ----------
function parseHash() {
  const [, name, id] = (window.location.hash || "").split("/");
  if (name === "new" || name === "tools") return { name };
  if (name === "pack" && id) return { name: "pack", id: decodeURIComponent(id) };
  return { name: "packs" };
}

function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = useCallback((name, id) => {
    window.location.hash = id ? `#/${name}/${encodeURIComponent(id)}` : `#/${name}`;
  }, []);
  return [route, go];
}

const NAV = [
  { key: "packs", label: "Packs" },
  { key: "new", label: "New pack" },
  { key: "tools", label: "Quick tools" },
];

export default function App() {
  const online = useOnline();
  const banner = useConnectionBanner(online);
  const [route, go] = useRoute();
  const [status, setStatus] = useState("checking");
  const [libraryKey, setLibraryKey] = useState(0);
  const [syncState, setSyncState] = useState(null); // null | "syncing" | "synced" | "local"

  const refreshStatus = useCallback(async () => {
    setStatus(await getOnDeviceStatus());
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus, online]);

  // On load and whenever we come back online: Remote Config, anonymous sign-in, pack sync.
  useEffect(() => {
    if (!online) return;
    let alive = true;
    refreshConfig();
    setSyncState("syncing");
    syncPacks(validatePack).then((res) => {
      if (!alive) return;
      setSyncState(res ? "synced" : "local");
      if (res?.pulled) setLibraryKey((k) => k + 1);
    });
    return () => {
      alive = false;
    };
  }, [online]);

  // "Lights out" theme: the whole UI dims when the network drops.
  useEffect(() => {
    document.documentElement.dataset.power = online ? "on" : "off";
  }, [online]);

  const brainTone = status === "available" ? "ok" : status === "unsupported" || status === "unavailable" ? "bad" : "warn";
  const activeNav = route.name === "pack" ? "packs" : route.name;

  return (
    <div className="app">
      <div className="glow" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      {banner && (
        <div className={`conn-banner ${banner}`} role="status" aria-live="polite">
          {banner === "offline" ? (
            <>
              <strong>⚡ No light, no data? Lightout is still working.</strong>
              <span>
                {status === "available"
                  ? "Your packs and offline brain are ready. Everything runs on this device."
                  : "Your packs still open offline. Download the offline brain next time you're online for AI marking."}
              </span>
            </>
          ) : (
            <strong>Back online — cloud available again</strong>
          )}
        </div>
      )}

      <header className="topbar">
        <a className="mark" href="#/packs" aria-label="Lightout home">
          <img src="/icon.svg" alt="" width="34" height="34" />
          <span className="wordmark">
            Light<span className="out">out</span>
            <small>Study packs</small>
          </span>
        </a>
        <div className="meter" role="status" aria-live="polite">
          <div className={`reading ${online ? "ok" : "bad"}`}>
            <span className="k">Grid</span>
            <span className="v">
              <span className="dot" />
              {online ? "Online" : "Offline"}
            </span>
          </div>
          <div className={`reading ${brainTone}`}>
            <span className="k">Offline brain</span>
            <span className="v">
              <span className="dot" />
              {BRAIN_SHORT[status] || status}
            </span>
          </div>
        </div>
      </header>

      {DEBUG && <DebugPanel online={online} />}

      <nav className="mainnav" aria-label="Main">
        {NAV.map((n) => (
          <a key={n.key} href={`#/${n.key}`} className={activeNav === n.key ? "on" : ""} aria-current={activeNav === n.key ? "page" : undefined}>
            {n.label}
          </a>
        ))}
        {syncState && (
          <span className={`sync-state ${syncState}`} title="Packs sync to your anonymous Firebase account when online">
            {syncState === "syncing" ? "Syncing…" : syncState === "synced" ? "Synced" : "On this device"}
          </span>
        )}
      </nav>

      <section className="how" aria-label="How it works">
        <ol className="steps">
          <li>
            <span className="step-n">1</span> Prep with light: build a pack in the cloud
          </li>
          <li aria-hidden="true" className="step-arrow">
            →
          </li>
          <li>
            <span className="step-n">2</span> Study in the dark: AI runs on your laptop
          </li>
          <li aria-hidden="true" className="step-arrow">
            →
          </li>
          <li>
            <span className="step-n">3</span> Cloud only when needed
          </li>
        </ol>
        {status === "unsupported" && (
          <p className="how-note">
            Offline mode needs <strong>Chrome on desktop (v139+)</strong>. Other browsers still work via the cloud.
          </p>
        )}
      </section>

      {route.name === "packs" && (
        <section className="hero compact">
          <h1 aria-label="Prep with light. Study in the dark.">
            <span className="line" aria-hidden="true">
              <span>Prep with light.</span>
            </span>
            <span className="line" aria-hidden="true">
              <span>
                Study in the <em className="flicker">dark</em>.
              </span>
            </span>
          </h1>
          <p className="lede">
            Turn your lecture notes, PDFs and photos into a Study Pack while you have data. Then read, quiz yourself and get
            answers marked on your own laptop when NEPA takes light.
          </p>
        </section>
      )}

      {(route.name === "packs" || route.name === "tools") && <OfflineBrainPanel status={status} online={online} onRefresh={refreshStatus} />}

      <div className="screen" key={route.name + (route.id || "")}>
        {route.name === "packs" && (
          <PackLibrary online={online} refreshKey={libraryKey} onOpen={(id) => go("pack", id)} onNew={() => go("new")} />
        )}
        {route.name === "new" && (
          <NewPack
            online={online}
            onCreated={(pack) => {
              setLibraryKey((k) => k + 1);
              go("pack", pack.id);
            }}
          />
        )}
        {route.name === "pack" && <PackView packId={route.id} online={online} onStatus={setStatus} onBack={() => go("packs")} />}
        {route.name === "tools" && <QuickTools online={online} onStatus={setStatus} />}
      </div>

      <footer className="footer">
        <div className="ticker" aria-hidden="true">
          <div>
            {Array.from({ length: 2 }).map((_, k) => (
              <span key={k}>
                Prep with light <i>✦</i> Study in the dark <i>✦</i> No light <i>✦</i> No data <i>✦</i> No problem <i>✦</i>{" "}
              </span>
            ))}
          </div>
        </div>
        <p>Built with Firebase AI Logic hybrid inference · App Check · Auth · Firestore · Remote Config · Hosting.</p>
      </footer>
    </div>
  );
}
