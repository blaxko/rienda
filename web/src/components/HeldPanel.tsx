import { useEffect, useState } from "react";
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
  const key = ["requests", reinId.toString()];
  const q = useQuery({
    queryKey: key,
    queryFn: () => rienda!.getRequests(reinId, { status: "Pending" }),
    refetchInterval: 2000,
  });
  // Requests the owner just approved or denied (receipt confirmed). They leave the list at once; a re-read that
  // is still stale (the RPC may lag a block behind the receipt) can't bring them back.
  const [resolved, setResolved] = useState<Set<string>>(() => new Set());
  const [seen, setSeen] = useState(false);
  const raw = q.data ?? [];
  const pending = raw.filter((r) => !resolved.has(r.id.toString()));
  useEffect(() => {
    if (raw.length > 0) setSeen(true);
    // forget a resolved id once the contract no longer lists it as pending
    setResolved((prev) => {
      const live = new Set(raw.map((r) => r.id.toString()));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  async function act(fn: "approve" | "deny", id: bigint) {
    if (!account) return;
    let ok = false;
    try {
      await tx.run(fn === "approve" ? `Approve request #${id}` : `Deny request #${id}`, {
        address: RIENDA!,
        abi: riendaAbi,
        functionName: fn,
        args: [id],
        chainId: chain.id,
      }, account);
      ok = true;
    } catch {
      /* shown by TxStatus */
    }
    if (ok) {
      setResolved((prev) => new Set(prev).add(id.toString()));
      qc.setQueryData(key, (old: typeof raw | undefined) => old?.filter((r) => r.id !== id));
    }
    void qc.invalidateQueries({ queryKey: ["requests"] });
    onDone();
  }

  if (pending.length === 0 && !seen && tx.state.phase === "idle") return null;

  return (
    <div className="card held">
      <h2>Waiting for you {pending.length > 0 && <span className="status status-Held">{pending.length}</span>}</h2>
      {pending.length === 0 && <p className="card-note" role="status" style={{ marginTop: 0, paddingBottom: 12 }}>Nothing is waiting for you.</p>}
      {pending.map((r) => {
        const held = view.held.get(r.id);
        const label = view.label(r.to);
        const short = r.amount > balance;
        return (
          <div key={r.id.toString()} className="row" style={{ padding: "16px 0", borderTop: "1px solid var(--line)", alignItems: "flex-start" }}>
            <div>
              <strong>${fmtUsdc(r.amount, decimals)}</strong> to {label ?? "Unknown address"}{" "}
              <span className="mono muted">{shortAddr(r.to)}</span>
              {held?.args.memo ? <div className="muted">“{held.args.memo}”</div> : null}
              <div className="muted">Request #{r.id.toString()} · {fmtDateTime(r.createdAt)}</div>
              {short && <div className="field-error">Balance is lower than this request. Deposit first.</div>}
            </div>
            <div className="actions">
              <button className="btn good" disabled={!canAct || tx.busy || short} onClick={() => act("approve", r.id)}>Approve</button>
              <button className="btn ghost" disabled={!canAct || tx.busy} onClick={() => act("deny", r.id)}>Deny</button>
            </div>
          </div>
        );
      })}
      <TxStatus state={tx.state} />
    </div>
  );
}
