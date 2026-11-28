import { useState } from "react";
import { useUpdateReady } from "../lib/swUpdate.js";

export default function UpdateToast() {
  const ready = useUpdateReady();
  const [dismissed, setDismissed] = useState(false);
  if (!ready || dismissed) return null;
  return (
    <div className="update-toast" role="status">
      <span>Updated — refresh for the latest version</span>
      <button type="button" className="update-refresh" onClick={() => window.location.reload()}>
        Refresh
      </button>
      <button type="button" className="update-x" onClick={() => setDismissed(true)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
