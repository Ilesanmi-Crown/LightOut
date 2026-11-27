import { useEffect, useState } from "react";
import { getSavings, onSavingsChange } from "../lib/savings.js";
import { getConfig, onConfigChange } from "../lib/config.js";
import { formatMB, formatNaira } from "../lib/format.js";

/** "Saved X MB of data (≈ ₦Y)" from on-device AI calls; naira-per-MB comes from Remote Config. */
export default function SavingsCard() {
  const [savings, setSavings] = useState(null);
  const [rate, setRate] = useState(getConfig().naira_per_mb);

  useEffect(() => {
    getSavings().then(setSavings);
    const offS = onSavingsChange(setSavings);
    const offC = onConfigChange((c) => setRate(c.naira_per_mb));
    return () => {
      offS();
      offC();
    };
  }, []);

  if (!savings) return null;
  const mb = savings.bytesSaved / (1024 * 1024);

  return (
    <section className="panel savings" aria-label="Data saved by on-device AI">
      <div className="savings-main">
        <span className="sec-n">Data saved by studying on-device</span>
        <p className="savings-big">
          Saved <b>{formatMB(savings.bytesSaved)} MB</b> of data <span>(≈ {formatNaira(mb * rate)})</span>
        </p>
      </div>
      <dl className="savings-stats">
        <div>
          <dt>{savings.offlineAnswers}</dt>
          <dd>questions answered offline</dd>
        </div>
        <div>
          <dt>{savings.onDeviceCalls}</dt>
          <dd>on-device AI calls</dd>
        </div>
        <div>
          <dt>₦{rate}</dt>
          <dd>per MB (Remote Config)</dd>
        </div>
      </dl>
    </section>
  );
}
