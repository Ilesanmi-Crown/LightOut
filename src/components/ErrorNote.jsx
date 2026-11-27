/**
 * One short sentence + what to do next. Raw technical details (if any) sit behind "Details".
 * `error` can be a string or { text, details }.
 */
export default function ErrorNote({ error }) {
  if (!error) return null;
  const { text, details } = typeof error === "string" ? { text: error } : error;
  return (
    <div className="error" role="alert">
      <span aria-hidden="true">!</span>
      <div className="error-body">
        <p>{text}</p>
        {details && (
          <details className="error-details">
            <summary>Details</summary>
            <pre>{details}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
