export function formatMB(bytes) {
  const mb = bytes / (1024 * 1024);
  if (mb === 0) return "0";
  if (mb < 0.01) return mb.toFixed(3);
  if (mb < 10) return mb.toFixed(2);
  return mb.toFixed(1);
}

export function formatNaira(n) {
  if (n === 0) return "₦0";
  if (n < 0.01) return `₦${n.toPrecision(2)}`;
  if (n < 1) return `₦${n.toFixed(2)}`;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;
}

export function formatKB(bytes) {
  if (bytes == null) return "–";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

export function formatSecsShort(ms) {
  if (ms == null) return "–";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
