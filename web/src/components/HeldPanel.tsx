import { useQuery, useQueryClient } from "@tanstack/react-query";
import { riendaAbi } from "@rienda/sdk";
import { RIENDA, chain, rienda } from "../config";
import { useTx } from "../lib/tx";
import { fmtDateTime, fmtUsdc, shortAddr } from "../lib/format";
import type { ReinView } from "../lib/events";
import { TxStatus } from "./TxStatus";

type Props = {
  reinId: bigint;
  view: ReinView;
  decimals: number;
  balance: bigint;
  /** connected wallet is the owner, on the right network */
  canAct: boolean;
  /** called after any approve/deny so the page and feed refresh */
  onDone: () => void;
  account?: `0x${string}`;
};

/** "Waiting for you": Pending held requests with Approve / Deny. Pending state is read from the contract. */
export function HeldPanel({ reinId, view, decimals, balance, canAct, onDone, account }: Props) {
  const tx = useTx();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["requests", reinId.toString()],
    queryFn: () => rienda!.getRequests(reinId, { status: "Pending" }),
    refetchInterval: 2000,
  });
  const pending = q.data ?? [];

  async function act(fn: "approve" | "deny", id: bigint) {
    if (!account) return;
    try {
      await tx.run(fn === "approve" ? `Approve request #${id}` : `Deny request #${id}`, {
        address: RIENDA!,
        abi: riendaAbi,
        functionName: fn,
        args: [id],
        chainId: chain.id,
      }, account);
    } catch {
      /* shown by TxStatus */
    } finally {
      await qc.invalidateQueries({ queryKey: ["requests"] });
      onDone();
    }
  }

  if (pending.length === 0 && tx.state.phase === "idle") return null;

  return (
    <div className="card" style={{ borderColor: "var(--amber)" }}>
      <h2>Waiting for you {pending.length > 0 && <span className="status status-Frozen" style={{ background: "var(--amber-bg)", color: "var(--amber)" }}>{pending.length}</span>}</h2>
      {pending.map((r) => {
        const held = view.held.get(r.id);
        const label = view.label(r.to);
        const short = r.amount > balance;
        return (
          <div key={r.id.toString()} className="row" style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
            <div>
              <strong>${fmtUsdc(r.amount, decimals)}</strong> to {label ?? "Unknown address"}{" "}
              <span className="mono muted">{shortAddr(r.to)}</span>
              {held?.args.memo ? <div className="muted">“{held.args.memo}”</div> : null}
              <div className="muted">Request #{r.id.toString()} · {fmtDateTime(r.createdAt)}</div>
              {short && <div className="tx tx-err">Balance is lower than this request. Deposit first.</div>}
            </div>
            <div className="actions">
              <button className="good" disabled={!canAct || tx.busy || short} onClick={() => act("approve", r.id)}>Approve</button>
              <button className="ghost" disabled={!canAct || tx.busy} onClick={() => act("deny", r.id)}>Deny</button>
            </div>
          </div>
        );
      })}
      <TxStatus state={tx.state} />
    </div>
  );
}
