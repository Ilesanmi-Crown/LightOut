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
import OfflineBrain from "./screens/OfflineBrain.jsx";
import { useDownload } from "./lib/download.js";

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
  if (name === "new" || name === "tools" || name === "brain") return { name };
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
  { key: "brain", label: "Offline brain" },
];

export default function App() {
  const online = useOnline();
  const banner = useConnectionBanner(online);
  const [route, go] = useRoute();
  const [status, setStatus] = useState("checking");
  const [libraryKey, setLibraryKey] = useState(0);
  const [syncState, setSyncState] = useState(null); // null | "syncing" | "synced" | "local"
  const { progress: downloadProgress } = useDownload();

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
              {status !== "available" && <span>AI marking needs the offline brain.</span>}
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
            <span className="k">Internet</span>
            <span className="v">
              <span className="dot" />
              {online ? "Online" : "Offline"}
            </span>
          </div>
          <a href="#/brain" className={`reading chip-link ${brainTone}`} title="Offline brain: AI that works without internet">
            <span className="k">Offline brain</span>
            <span className="v">
              <span className="dot" />
              {downloadProgress !== null ? `Downloading ${Math.round(downloadProgress * 100)}%` : BRAIN_SHORT[status] || status}
            </span>
          </a>
        </div>
      </header>

      {DEBUG && <DebugPanel online={online} />}

      <nav className="mainnav" aria-label="Main">
        {NAV.map((n) => (
          <a key={n.key} href={`#/${n.key}`} className={activeNav === n.key ? "on" : ""} aria-current={activeNav === n.key ? "page" : undefined}>
            {n.label}
          </a>
        ))}
        {(syncState === "syncing" || syncState === "synced") && (
          <span className={`sync-state ${syncState}`} title="Your packs are backed up when you're online">
            {syncState === "syncing" ? "Backing up…" : "Backed up"}
          </span>
        )}
      </nav>

      {route.name === "tools" && <OfflineBrainPanel status={status} online={online} />}

      <div className="screen" key={route.name + (route.id || "")}>
        {route.name === "packs" && (
          <PackLibrary
            online={online}
            status={status}
            refreshKey={libraryKey}
            onOpen={(id) => go("pack", id)}
            onNew={() => go("new")}
          />
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
        {route.name === "brain" && <OfflineBrain status={status} online={online} onRefresh={refreshStatus} />}
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
