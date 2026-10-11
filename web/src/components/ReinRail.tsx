import { useEffect, useLayoutEffect, useRef } from "react";
import { Lock01 } from "@untitledui/icons";
import { REIN_H, REIN_W } from "../lib/reinLine";
import { reducedMotion } from "../lib/motion";
import { ReinLine } from "./ReinLine";
import type { DemoEvent } from "../lib/simulate";

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const COLORS: Record<string, string> = { Paid: "#2F6B4F", Held: "#8B5A2B", Blocked: "#A2342B", Reverted: "#A2342B" };

/**
 * The demo's track: the rein line itself. A payment is a dot that travels along it from the agent. Paid carries on
 * to the merchant; Held parks at the gate; Blocked reaches the gate, the gate snaps shut and the dot falls back;
 * frozen leaves the gate locked. Positions come from the real path (getPointAtLength), so the dot follows the curve.
 */
export function ReinRail({ last, frozen }: { last: DemoEvent | undefined; frozen: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const dot = useRef<HTMLElement>(null);
  const gateEl = useRef<HTMLSpanElement>(null);
  const geo = useRef<{ path: SVGPathElement; len: number; tGate: number } | null>(null);

  useLayoutEffect(() => {
    const path = box.current!.querySelector("path")!;
    const len = path.getTotalLength();
    // the gate sits where the line crosses the middle of the track
    let best = 0.5, bd = Infinity;
    for (let i = 20; i <= 980; i++) { const t = i / 1000, d = Math.abs(path.getPointAtLength(len * t).x - REIN_W / 2); if (d < bd) { bd = d; best = t; } }
    geo.current = { path, len, tGate: best };
    const p = path.getPointAtLength(len * best);
    gateEl.current!.style.left = `${(p.x / REIN_W) * 100}%`;
    gateEl.current!.style.top = `${(p.y / REIN_H) * 100}%`;
  }, []);

  const place = (t: number, opacity = 1) => {
    const g = geo.current, d = dot.current;
    if (!g || !d) return;
    const p = g.path.getPointAtLength(g.len * Math.min(1, Math.max(0, t)));
    d.style.left = `${(p.x / REIN_W) * 100}%`;
    d.style.top = `${(p.y / REIN_H) * 100}%`;
    d.style.opacity = String(opacity);
  };

  useEffect(() => {
    const g = geo.current, d = dot.current;
    if (!g || !d) return;
    if (!last || reducedMotion()) { d.style.opacity = "0"; return; }
    d.style.background = COLORS[last.outcome] ?? "#14110F";
    const tg = g.tGate;
    // [from, to, ms, fadeAtEnd]
    const legs: [number, number, number, boolean][] =
      last.outcome === "Paid" ? [[0, tg, 450, false], [tg, 1, 450, true]]
      : last.outcome === "Held" ? [[0, tg - 0.03, 600, false]]
      : [[0, tg - 0.04, 480, false], [tg - 0.04, tg - 0.22, 320, true]];
    let raf = 0, leg = 0, start = performance.now();
    const tick = (now: number) => {
      const [a, b, ms, fade] = legs[leg]!;
      const k = Math.min(1, (now - start) / ms);
      place(a + (b - a) * ease(k), fade && leg === legs.length - 1 ? 1 - k * 0.9 : 1);
      if (k >= 1) {
        if (leg < legs.length - 1) { leg++; start = now; } else { if (fade) d.style.opacity = "0"; return; }
      }
      raf = requestAnimationFrame(tick);
    };
    place(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [last?.id]);

  return (
    <span className={`rail ${last ? last.outcome : ""} ${frozen ? "frozen" : ""}`} ref={box} aria-hidden="true">
      <ReinLine className="rail-line" draw={false} />
      <span className="gate2" ref={gateEl} key={`g${last?.id ?? 0}`}>{frozen ? <Lock01 width={13} height={13} /> : null}</span>
      <i className="dot2" ref={dot as React.RefObject<HTMLElement>} />
    </span>
  );
}
