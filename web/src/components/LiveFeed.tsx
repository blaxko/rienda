import { useEffect, useState } from "react";
import { CheckCircle, XCircle } from "@untitledui/icons";
import { ATTEMPTS, pillClass } from "../lib/attempts";
import { reducedMotion } from "../lib/motion";

/** A looping list of example payment attempts: allowed, held, blocked. */
export function LiveFeed() {
  const [n, setN] = useState(4);
  useEffect(() => {
    if (reducedMotion()) return;
    const t = setInterval(() => setN((x) => x + 1), 2800);
    return () => clearInterval(t);
  }, []);
  const rows = Array.from({ length: 5 }, (_, i) => ({ k: n - i, a: ATTEMPTS[(n - i) % ATTEMPTS.length]! }));
  return (
    <div className="feed-card">
      <div className="head"><span className="live-dot">Agent activity</span><span>Example data</span></div>
      <ul className="attempts" aria-label="Example agent payment attempts">
        {rows.map(({ k, a }) => (
          <li key={k} className={a.outcome}>
            <span className={`${pillClass(a.outcome)} out`}>
              {a.outcome === "Blocked" ? <XCircle width={14} height={14} aria-hidden /> : <CheckCircle width={14} height={14} aria-hidden />}
              {a.outcome}
            </span>
            <span><span className="who">{a.who}</span><div className="why">{a.why}</div></span>
            <span className="amt">{a.amount}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
