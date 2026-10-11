import { REIN_D, REIN_D_VERTICAL, REIN_H, REIN_W } from "../lib/reinLine";

/**
 * The rein line as a thin saddle stroke. It stretches to fill its box (preserveAspectRatio none) but the stroke
 * stays 1.5px. `draw` makes it draw itself when it scrolls into view (or on load for `onLoad`); with reduced
 * motion it is simply there.
 */
export function ReinLine({ className = "", vertical = false, draw = true, onLoad = false }: { className?: string; vertical?: boolean; draw?: boolean; onLoad?: boolean }) {
  return (
    <svg
      className={`rein-line ${draw ? "draw" : ""} ${onLoad ? "on-load" : ""} ${className}`}
      viewBox={vertical ? `0 0 ${REIN_H} ${REIN_W}` : `0 0 ${REIN_W} ${REIN_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d={vertical ? REIN_D_VERTICAL : REIN_D} pathLength={1} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
