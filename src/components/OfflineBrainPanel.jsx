import { useDownload } from "../lib/download.js";

/** One-line nudge to get the offline brain. Details and the download itself live on the Offline brain screen. */
export default function OfflineBrainPanel({ status, online }) {
  const { progress } = useDownload();
  // Offline, the banner already says this (and the download needs internet).
  if (!online && progress === null) return null;
  if (status !== "downloadable" && status !== "downloading" && progress === null) return null;
  return (
    <a className="nudge" href="#/brain">
      <span aria-hidden="true">⬇️</span>
      <span>
        {progress !== null || status === "downloading"
          ? `Downloading the offline brain${progress !== null ? ` · ${Math.round(progress * 100)}%` : "…"}`
          : "Get the offline brain so AI works without internet."}
      </span>
      <b>Set up →</b>
    </a>
  );
}
