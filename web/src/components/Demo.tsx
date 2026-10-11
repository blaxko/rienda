import { useState } from "react";
import { AlertTriangle, CheckCircle, Lock01, XCircle } from "@untitledui/icons";
import { ReinRail } from "./ReinRail";
import { useTween } from "../lib/motion";
import { DEMO_LIMITS, DEMO_MERCHANTS, decide, initialDemo, pay, type Outcome } from "../lib/simulate";

const AMOUNTS = [2, 4, 12, 60, 500];
const usd = (n: number) => `$${n.toFixed(2)}`;

const PILL: Record<Outcome, string> = { Paid: "pill paid", Held: "pill amber", Blocked: "pill red", Reverted: "pill red" };

/** A local model of the contract's rules (see lib/simulate.ts). No wallet, no transactions. */
export function Demo() {
  const [s, setS] = useState(initialDemo);
  const [to, setTo] = useState("news");
  const [amount, setAmount] = useState(2);

  const last = s.events[0];
  const bal = useTween(s.balance), spent = useTween(s.spentToday);
  const pct = Math.min(100, (s.spentToday / DEMO_LIMITS.dailyCap) * 100);
  const meterClass = pct >= 100 ? "full" : pct >= 80 ? "hot" : "";

  return (
    <div className="demo" id="demo-panel">
      <div className="demo-left">
        <div>
          <h3>Your agent</h3>
          <p className="muted" style={{ marginTop: 6 }}>Pick who it pays and how much, then send.</p>
        </div>

        <div>
          <label htmlFor="demo-to">Pay to</label>
          <select id="demo-to" value={to} onChange={(e) => setTo(e.target.value)}>
            {DEMO_MERCHANTS.map((m) => (
              <option key={m.id} value={m.id}>{m.label} {m.allowed ? "" : "(not on the list)"}</option>
            ))}
          </select>
        </div>

        <div>
          <label id="demo-amt-label">Amount</label>
          <div className="amount-chips" role="group" aria-labelledby="demo-amt-label">
            {AMOUNTS.map((a) => (
              <button key={a} className="amount-chip" aria-pressed={amount === a} onClick={() => setAmount(a)}>${a}</button>
            ))}
          </div>
        </div>

        <button className="btn" onClick={() => setS((x) => pay(x, to, amount))}>Send ${amount} →</button>

        <div>
          <label>Or try a case</label>
          <div className="preset-row">
            <button className="btn ghost small" onClick={() => { setTo("unknown"); setAmount(500); }}>Poisoned page: $500 to a stranger</button>
            <button className="btn ghost small" onClick={() => { setTo("gpu"); setAmount(12); }}>Larger GPU order</button>
          </div>
        </div>

        <dl className="limits" aria-label="This rein's limits">
          <dt>Per payment</dt><dd>${DEMO_LIMITS.perPayCap}</dd>
          <dt>Per day</dt><dd>${DEMO_LIMITS.dailyCap}</dd>
          <dt>Hold ceiling</dt><dd>${DEMO_LIMITS.holdCeiling}</dd>
          <dt>Strikes allowed</dt><dd>{DEMO_LIMITS.maxStrikes}</dd>
        </dl>
        <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => { setS(initialDemo()); setTo("news"); setAmount(2); }}>Reset demo</button>
      </div>

      <div className="demo-right" aria-live="polite">
        <div>
          <h3>What the owner sees</h3>
          <p className="muted" style={{ marginTop: 6 }}>Simulated with the same rules as the contract. Nothing is sent to a chain.</p>
        </div>

        <div className="lane2" aria-hidden="true">
          <span className="node">Agent</span>
          <ReinRail last={last} frozen={s.frozen} />
          <span className="node">{last && last.outcome === "Paid" ? last.to : "Merchant"}</span>
        </div>

        {s.frozen && (
          <div className="banner-frozen" role="alert">
            <Lock01 width={22} height={22} aria-hidden />
            <div>
              <strong>Reined in</strong>
              Your agent is frozen after {DEMO_LIMITS.maxStrikes} strikes. The balance did not move. Any further call reverts.
            </div>
          </div>
        )}

        <div className="numbers">
          <div className="num"><div className="k">Balance</div><div className="v">{usd(bal)}</div></div>
          <div className="num">
            <div className="k">Spent today</div>
            <div className="v">{usd(spent)} <small>/ ${DEMO_LIMITS.dailyCap}</small></div>
            <div className={`meter ${meterClass}`}><div style={{ width: `${pct}%` }} /></div>
          </div>
          <div className="num"><div className="k">Strikes</div><div className="v">{s.strikes} <small>of {DEMO_LIMITS.maxStrikes}</small></div></div>
        </div>

        {s.held.length > 0 && (
          <div className="held-box">
            <strong style={{ color: "var(--text)", fontWeight: 500 }}>Waiting for you</strong>
            {s.held.map((h) => (
              <div className="row" key={h.id}>
                <span>{usd(h.amount)} to {h.to}</span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button className="btn good small" disabled={h.amount > s.balance} onClick={() => setS((x) => decide(x, h.id, true))}>Approve</button>
                  <button className="btn ghost small" onClick={() => setS((x) => decide(x, h.id, false))}>Deny</button>
                </span>
              </div>
            ))}
          </div>
        )}

        {s.events.length === 0 ? (
          <p className="empty-note">No activity yet. Send a payment to see how it is handled.</p>
        ) : (
          <ul className="log">
            {s.events.map((e) => (
              <li key={e.id}>
                {e.outcome === "Reverted" && e.to === "Agent" ? (
                  <span className="pill ink" style={{ width: "max-content" }}><Lock01 width={14} height={14} aria-hidden />Frozen</span>
                ) : (
                  <span className={PILL[e.outcome]} style={{ width: "max-content" }}>
                    {e.outcome === "Paid" ? <CheckCircle width={14} height={14} aria-hidden /> : e.outcome === "Held" ? <AlertTriangle width={14} height={14} aria-hidden /> : <XCircle width={14} height={14} aria-hidden />}
                    {e.outcome}
                  </span>
                )}
                <span>
                  <span style={{ color: "var(--text)" }}>{e.to}</span>
                  <div className="sub">{e.note}</div>
                </span>
                <span className="amt">{e.amount > 0 ? usd(e.amount) : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
