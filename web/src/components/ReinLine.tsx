import { REIN_D, REIN_D_VERTICAL, REIN_H, REIN_LEVEL_D, REIN_LEVEL_MIN, REIN_LEVEL_RANGE, REIN_LEVEL_V_D, REIN_W } from "../lib/reinLine";

/**
 * The rein line as a thin saddle stroke. It stretches to fill its box (preserveAspectRatio none) but the stroke
 * stays 1.5px. `draw` makes it draw itself when it scrolls into view (or on load for `onLoad`); with reduced
 * motion it is simply there.
 */
export function ReinLine({ className = "", vertical = false, draw = true, onLoad = false, level = false }: { className?: string; vertical?: boolean; draw?: boolean; onLoad?: boolean; level?: boolean }) {
  const d = level ? (vertical ? REIN_LEVEL_V_D : REIN_LEVEL_D) : vertical ? REIN_D_VERTICAL : REIN_D;
  const viewBox = level
    ? vertical ? `${REIN_LEVEL_MIN} 0 ${REIN_LEVEL_RANGE} ${REIN_W}` : `0 ${REIN_LEVEL_MIN} ${REIN_W} ${REIN_LEVEL_RANGE}`
    : vertical ? `0 0 ${REIN_H} ${REIN_W}` : `0 0 ${REIN_W} ${REIN_H}`;
  return (
    <svg
      className={`rein-line ${draw ? "draw" : ""} ${onLoad ? "on-load" : ""} ${className}`}
      viewBox={viewBox}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
