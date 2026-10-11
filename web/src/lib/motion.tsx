import { Fragment, useEffect, useRef, useState } from "react";

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Adds `.in` to every `.reveal` (and to each child of `.stagger`, with an --i index) as it scrolls into view.
 * With reduced motion everything is revealed at once. Re-run when the page's reveal elements change.
 */
export function useRevealOnScroll(routeKey?: string) {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".reveal, .stagger > *, .draw, .reveal-steps")];
    document.querySelectorAll<HTMLElement>(".stagger").forEach((g) => [...g.children].forEach((c, i) => (c as HTMLElement).style.setProperty("--i", String(i))));
    if (reducedMotion() || typeof IntersectionObserver === "undefined") {
      els.forEach((e) => e.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }),
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [routeKey]);
}

/** Tweens a number toward `value` (ms, eased). With reduced motion it jumps straight there. */
export function useTween(value: number, ms = 500): number {
  const [v, setV] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reducedMotion() || from.current === value) { from.current = value; setV(value); return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const cur = a + (value - a) * ease(t);
      from.current = cur;
      setV(cur);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return v;
}

/** A number that rolls up from 0 the first time it enters the viewport. */
export function CountUp({ to, decimals = 0, prefix = "", suffix = "", ms = 1100 }: { to: number; decimals?: number; prefix?: string; suffix?: string; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [armed, setArmed] = useState(reducedMotion());
  useEffect(() => {
    if (armed || !ref.current) return;
    const io = new IntersectionObserver((en) => { if (en[0]?.isIntersecting) { setArmed(true); io.disconnect(); } }, { threshold: 0.6 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [armed]);
  const v = useTween(armed ? to : 0, ms);
  return <span ref={ref}>{prefix}{v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}

/** Headline split into words that rise in one after another (plain text when motion is off). */
export function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <Fragment key={i}>
          <span className="w" style={{ ["--i" as string]: i }}>{w}</span>{" "}
        </Fragment>
      ))}
    </>
  );
}
