import { AlertTriangle } from "@untitledui/icons";
import { explain } from "../lib/errors";

/**
 * Every error state in the dashboard: one short sentence, an optional Try again, and the technical text tucked in a
 * Details section that wraps and scrolls instead of running off the screen.
 */
export function ErrorNotice({ error, title, onRetry, retryLabel = "Try again", className = "" }: { error: unknown; title: string; onRetry?: () => void; retryLabel?: string; className?: string }) {
  const ex = explain(error);
  const text = ex.kind === "rejected" ? ex.hint : `${title} ${ex.hint}`;
  return (
    <div className={`banner banner-red err-notice ${className}`} role="alert">
      <AlertTriangle width={18} height={18} aria-hidden />
      <div className="err-body">
        <p className="err-text">{text}</p>
        {ex.detail && (
          <details className="err-details">
            <summary>Details</summary>
            <pre>{ex.detail}</pre>
          </details>
        )}
      </div>
      {onRetry && <button className="btn small" onClick={onRetry}>{retryLabel}</button>}
    </div>
  );
}
