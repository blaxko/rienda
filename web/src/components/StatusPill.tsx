import { Lock01 } from "@untitledui/icons";

/** Rein status: Active (saddle), Frozen (ink with a lock), Closed (grey). */
export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`status status-${status}`}>
      {status === "Frozen" && <Lock01 width={13} height={13} aria-hidden />}
      {status}
    </span>
  );
}
