import { txUrl } from "../config";
import { fmtTime, fmtUsdc, shortAddr } from "../lib/format";
import type { ChainEvent, ReinView } from "../lib/events";

const REASON_TEXT: Record<number, string> = {
  1: "Recipient not on your allowed list", // NOT_ALLOWED
  2: "Above your hard limit", // ABOVE_CEILING
  3: "Too many payments waiting", // TOO_MANY_HELD
  4: "Not enough balance", // NO_FUNDS
};

type Props = {
  view: ReinView;
  times: Map<bigint, number>;
  decimals: number;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
};

function Who({ view, addr }: { view: ReinView; addr: string }) {
  const label = view.label(addr);
  // label and address are rendered as text nodes: never as HTML
  return <>{label ?? "Unknown address"} <span className="mono muted">{shortAddr(addr)}</span></>;
}

function Row({ e, view, times, decimals }: { e: ChainEvent; view: ReinView; times: Map<bigint, number>; decimals: number }) {
  const a = e.args;
  // Approved / Denied only carry a request id: take amount, merchant and memo from the Held event
  const held = e.name === "Approved" || e.name === "Denied" ? view.held.get(a.requestId) : undefined;
  const amount: bigint | undefined = a.amount ?? held?.args.amount;
  const to: string | undefined = a.to ?? held?.args.to;
  const memo: string | undefined = a.memo ?? held?.args.memo;

  let title: string = e.name;
  let reason: string | undefined;
  if (e.name === "Blocked") {
    title = "Blocked";
    reason = REASON_TEXT[Number(a.reason)] ?? "Blocked";
  } else if (e.name === "Frozen") {
    title = "Frozen";
    reason = a.auto_ ? "Frozen automatically after too many blocked attempts" : "Frozen by owner";
  } else if (e.name === "Unfrozen") {
    reason = "Owner unfroze the agent; strikes reset";
  } else if (e.name === "Held") {
    reason = `Waiting for your approval (request #${a.requestId})`;
  } else if (e.name === "Approved") {
    reason = `You approved request #${a.requestId}`;
  } else if (e.name === "Denied") {
    reason = `You denied request #${a.requestId}`;
  }

  return (
    <li className={e.name}>
      <span className="t">{fmtTime(times.get(e.blockNumber))}</span>
      <span className="o">{title}</span>
      <span className="detail">
        {amount !== undefined && <strong>${fmtUsdc(amount, decimals)}</strong>}
        {to && <> to <Who view={view} addr={to} /></>}
        {memo ? <> · “{memo}”</> : null}
        {reason && <div className="sub">{reason}{e.name === "Blocked" && ` · strike ${a.strikes}`}</div>}
        <div className="sub"><a href={txUrl(e.txHash)} target="_blank" rel="noreferrer">view tx</a></div>
      </span>
    </li>
  );
}

export function Feed({ view, times, decimals, loading, error, onRefresh }: Props) {
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Activity {loading && <span className="muted" style={{ fontWeight: 400, fontSize: ".85rem" }}>· loading history…</span>}</h2>
        <button className="ghost small" onClick={onRefresh}>Refresh</button>
      </div>
      {error && <p className="tx tx-err">Could not load activity: {error}</p>}
      {!loading && view.feed.length === 0 && !error && <p className="muted">No activity yet.</p>}
      <ul className="feed">
        {view.feed.map((e) => (
          <Row key={e.id} e={e} view={view} times={times} decimals={decimals} />
        ))}
      </ul>
    </div>
  );
}
