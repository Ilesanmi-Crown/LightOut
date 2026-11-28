import { useCloudStatus, cloudStatusText } from "../lib/cloudStatus.js";

/** Shows "Google's AI is busy — retrying (1/3)…" while a cloud call is backing off. */
export default function RetryNotice() {
  const s = useCloudStatus();
  if (!s) return null;
  return (
    <p className="retry-notice" role="status" aria-live="polite">
      <span className="btn-spinner" aria-hidden="true" /> {cloudStatusText(s)}
    </p>
  );
}
