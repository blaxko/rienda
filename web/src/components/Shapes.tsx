/** Soft, low-contrast shapes the glass sits on. Radial gradients only (no blur filters), moved by transform. */
export function Shapes({ className = "" }: { className?: string }) {
  return (
    <div className={`shapes ${className}`} aria-hidden="true">
      <i className="shape s1" />
      <i className="shape s2" />
      <i className="shape s3" />
    </div>
  );
}

