/**
 * A local model of Rienda.pay for the landing-page demo. It follows the same rule order as the
 * contract (PRD FR-8): not allowed, above ceiling, too many held, over cap -> held, no funds, paid.
 * Nothing here talks to a chain.
 */

export type DemoMerchant = { id: string; label: string; address: string; allowed: boolean };

export const DEMO_LIMITS = { perPayCap: 5, dailyCap: 20, holdCeiling: 50, maxStrikes: 3, maxHeld: 5, deposit: 30 };

export const DEMO_MERCHANTS: DemoMerchant[] = [
  { id: "news", label: "News API", address: "0x4a1f…93c2", allowed: true },
  { id: "gpu", label: "GPU minutes", address: "0x81bd…07e5", allowed: true },
  { id: "coffee", label: "Coffee", address: "0xc2e9…5d10", allowed: true },
  { id: "unknown", label: "Unknown address", address: "0x9fe4…c1a2", allowed: false },
];

export type Outcome = "Paid" | "Held" | "Blocked" | "Reverted";
export type Reason = "NOT_ALLOWED" | "ABOVE_CEILING" | "TOO_MANY_HELD" | "NO_FUNDS";

export type DemoEvent = {
  id: number;
  outcome: Outcome;
  amount: number;
  to: string;
  note: string;
};

export type DemoState = {
  balance: number;
  spentToday: number;
  strikes: number;
  frozen: boolean;
  held: { id: number; amount: number; to: string }[];
  events: DemoEvent[];
  nextId: number;
};

export const initialDemo = (): DemoState => ({
  balance: DEMO_LIMITS.deposit,
  spentToday: 0,
  strikes: 0,
  frozen: false,
  held: [],
  events: [],
  nextId: 1,
});

export const REASON_TEXT: Record<Reason, string> = {
  NOT_ALLOWED: "Recipient is not on the allowed list",
  ABOVE_CEILING: "Above the hold ceiling",
  TOO_MANY_HELD: "Too many payments already waiting",
  NO_FUNDS: "Not enough balance",
};

const push = (s: DemoState, e: Omit<DemoEvent, "id">): DemoState => ({
  ...s,
  events: [{ ...e, id: s.nextId }, ...s.events].slice(0, 20),
  nextId: s.nextId + 1,
});

const fmt = (n: number) => n.toFixed(2);

export function pay(s: DemoState, merchantId: string, amount: number): DemoState {
  const m = DEMO_MERCHANTS.find((x) => x.id === merchantId)!;
  const L = DEMO_LIMITS;
  if (s.frozen) {
    return push(s, { outcome: "Reverted", amount, to: m.label, note: "Rein is frozen. The call reverts and nothing moves." });
  }

  const strike = (reason: Reason): DemoState => {
    const strikes = s.strikes + 1;
    let next = push({ ...s, strikes }, { outcome: "Blocked", amount, to: m.label, note: `${REASON_TEXT[reason]} · strike ${strikes} of ${L.maxStrikes}` });
    if (strikes >= L.maxStrikes) {
      next = push({ ...next, frozen: true }, { outcome: "Reverted", amount: 0, to: "Agent", note: "Frozen automatically after too many blocked attempts" });
    }
    return next;
  };

  if (!m.allowed) return strike("NOT_ALLOWED");
  if (amount > L.holdCeiling) return strike("ABOVE_CEILING");
  if (s.held.length >= L.maxHeld) return strike("TOO_MANY_HELD");
  if (amount > L.perPayCap || s.spentToday + amount > L.dailyCap) {
    const id = s.nextId;
    const why = amount > L.perPayCap ? "Above the per-payment cap" : "Over the daily cap";
    return push({ ...s, held: [...s.held, { id, amount, to: m.label }] }, { outcome: "Held", amount, to: m.label, note: `${why} · waiting for the owner` });
  }
  if (amount > s.balance) return push(s, { outcome: "Blocked", amount, to: m.label, note: `${REASON_TEXT.NO_FUNDS} · no strike` });
  return push({ ...s, balance: s.balance - amount, spentToday: s.spentToday + amount }, { outcome: "Paid", amount, to: m.label, note: `$${fmt(amount)} sent from the contract to ${m.label}` });
}

export function decide(s: DemoState, heldId: number, approve: boolean): DemoState {
  const h = s.held.find((x) => x.id === heldId);
  if (!h) return s;
  const rest = { ...s, held: s.held.filter((x) => x.id !== heldId) };
  if (!approve) return push(rest, { outcome: "Blocked", amount: h.amount, to: h.to, note: "You denied this request" });
  if (h.amount > s.balance) return s;
  return push({ ...rest, balance: s.balance - h.amount, spentToday: s.spentToday + h.amount }, { outcome: "Paid", amount: h.amount, to: h.to, note: "You approved this request" });
}
