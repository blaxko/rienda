import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { erc20Abi, formatUnits } from "viem";
import { PAY_GAS_LIMIT, riendaAbi } from "@rienda/sdk";
import { RIENDA, USDC, addressUrl, chain, publicClient, rienda } from "../config";
import { useDecimals, useWallet } from "../hooks";
import { useReinFeed } from "../lib/useReinFeed";
import { useTx } from "../lib/tx";
import { fmtDateTime, fmtUsdc, parseUsdc, shortAddr } from "../lib/format";
import { TxStatus } from "../components/TxStatus";
import { Feed } from "../components/Feed";
import { HeldPanel } from "../components/HeldPanel";
import { AlertTriangle, Lock01, SlashCircle01 } from "@untitledui/icons";
import { StatusPill } from "../components/StatusPill";
import { Link } from "../router";
import { cleanAddress, parseAddress } from "../lib/address";

const GAS_WARN_PAYMENTS = 20n; // warn when the agent can't cover 20 pay calls

export function ReinPage({ reinId }: { reinId: bigint }) {
  const w = useWallet();
  const decimals = useDecimals();
  const qc = useQueryClient();
  const tx = useTx();
  const feed = useReinFeed(reinId);

  const reinQ = useQuery({
    queryKey: ["rein", reinId.toString()],
    enabled: !!rienda,
    queryFn: () => rienda!.getRein(reinId),
    refetchInterval: 2000,
  });
  const rein = reinQ.data;

  const monQ = useQuery({
    queryKey: ["agent-mon", rein?.agent],
    enabled: !!rein && rein.status !== "None",
    queryFn: async () => ({
      mon: await publicClient.getBalance({ address: rein!.agent }),
      gasPrice: await publicClient.getGasPrice(),
    }),
    refetchInterval: 5000,
  });

  const [depositAmt, setDepositAmt] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [mAddr, setMAddr] = useState("");
  const [mLabel, setMLabel] = useState("");

  if (!rienda) return <div className="empty"><h2>Not deployed yet</h2><p>Rienda has no contract on {chain.name} yet.</p></div>;
  if (reinQ.isLoading)
    return (
      <section aria-busy="true" aria-label={`Loading rein #${reinId}`}>
        <div className="skeleton" style={{ height: 44, width: 260, marginBottom: 40 }} />
        <div className="stats">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton" style={{ height: 84 }} />)}
        </div>
        <div className="skeleton" style={{ height: 200 }} />
      </section>
    );
  if (reinQ.error)
    return (
      <div className="banner banner-red" role="alert">
        <AlertTriangle width={18} height={18} aria-hidden />
        <span>Could not load the rein: {(reinQ.error as Error).message}</span>
        <button className="btn small" onClick={() => reinQ.refetch()}>Try again</button>
      </div>
    );
  if (!rein || rein.status === "None") {
    return (
      <div className="empty">
        <div className="icon"><SlashCircle01 width={22} height={22} aria-hidden /></div>
        <h2>Rein #{reinId.toString()} doesn't exist</h2>
        <p>Check the number in the address, or go back to your list.</p>
        <Link to="/app" className="btn">My reins</Link>
      </div>
    );
  }

  const isOwner = !!w.address && w.address.toLowerCase() === rein.owner.toLowerCase();
  const canOwnerAct = w.canAct && isOwner && !tx.busy;
  const todayDay = BigInt(Math.floor(Date.now() / 1000 / 86_400));
  const spentToday = rein.day === todayDay ? rein.spentToday : 0n; // contract resets lazily on the next pay
  const spentPct = rein.dailyCap > 0n ? Math.min(100, Number((spentToday * 100n) / rein.dailyCap)) : 0;
  const expired = rein.expiry <= BigInt(Math.floor(Date.now() / 1000));
  const autoFrozen = rein.status === "Frozen" && rein.strikes >= rein.maxStrikes;

  const perPaymentGas = PAY_GAS_LIMIT * (monQ.data?.gasPrice ?? 0n);
  const paymentsLeft = monQ.data && perPaymentGas > 0n ? monQ.data.mon / perPaymentGas : undefined;
  const lowGas = paymentsLeft !== undefined && paymentsLeft < GAS_WARN_PAYMENTS;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["rein"] });
    qc.invalidateQueries({ queryKey: ["agent-mon"] });
    qc.invalidateQueries({ queryKey: ["requests"] });
    feed.refresh();
  };
  const write = async (label: string, params: any) => {
    try {
      await tx.run(label, { address: RIENDA!, abi: riendaAbi, chainId: chain.id, ...params }, w.address!);
    } catch {
      /* shown by TxStatus */
    } finally {
      refresh();
    }
  };

  async function deposit() {
    const amt = parseUsdc(depositAmt, decimals);
    if (!amt || !w.address) return;
    const allowance = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [w.address, RIENDA!] });
    try {
      if (allowance < amt) {
        await tx.run("Approve USDC", { address: USDC, abi: erc20Abi, functionName: "approve", args: [RIENDA!, amt], chainId: chain.id }, w.address);
      }
    } catch {
      return;
    }
    await write("Deposit", { functionName: "deposit", args: [reinId, amt] });
    setDepositAmt("");
  }
  async function withdraw() {
    const amt = parseUsdc(withdrawAmt, decimals);
    if (!amt) return;
    await write("Withdraw", { functionName: "withdraw", args: [reinId, amt] });
    setWithdrawAmt("");
  }
  async function addMerchant() {
    const merchant = parseAddress(mAddr);
    if (!merchant || !mLabel.trim()) return;
    await write("Add merchant", { functionName: "setMerchant", args: [reinId, merchant, true, mLabel.trim()] });
    setMAddr("");
    setMLabel("");
  }

  const depositU = parseUsdc(depositAmt, decimals);
  const withdrawU = parseUsdc(withdrawAmt, decimals);

  return (
    <section>
      <Link to="/app" className="back">My reins</Link>
      <div className="page-head">
        <h1>Rein #{reinId.toString()}</h1>
        <StatusPill status={rein.status} />
      </div>

      {rein.status === "Frozen" && (
        <div className="frozen-banner" role="alert">
          <Lock01 width={24} height={24} aria-hidden />
          <div>
            <strong>{autoFrozen ? `Reined in — your agent is frozen after ${rein.maxStrikes} strikes` : "Reined in — you froze your agent"}</strong>
            <small>
              {autoFrozen
                ? `Rienda froze it after ${rein.maxStrikes} blocked attempts. Your funds didn't move.`
                : "It can't pay until you unfreeze it."}
            </small>
          </div>
        </div>
      )}
      {rein.status === "Closed" && <div className="banner banner-grey"><SlashCircle01 width={18} height={18} aria-hidden />This rein is closed. The balance was withdrawn and the agent can no longer pay.</div>}
      {expired && rein.status !== "Closed" && <div className="banner banner-amber"><AlertTriangle width={18} height={18} aria-hidden />This rein has expired. The agent can't pay until you create a new one.</div>}
      {w.isConnected && !isOwner && <div className="banner banner-grey">You're viewing someone else's rein. Controls are turned off.</div>}

      <div className="stats">
        <div className="stat"><div className="k">Balance</div><div className="v">${fmtUsdc(rein.balance, decimals)}</div></div>
        <div className="stat">
          <div className="k">Spent today</div>
          <div className="v">${fmtUsdc(spentToday, decimals)} <span className="of">/ ${fmtUsdc(rein.dailyCap, decimals)}</span></div>
          <div className={`meter ${spentPct >= 100 ? "full" : spentPct >= 80 ? "hot" : ""}`} role="progressbar" aria-label="Spent today" aria-valuemin={0} aria-valuemax={100} aria-valuenow={spentPct}><div style={{ width: `${spentPct}%` }} /></div>
          {spentPct >= 100 && <div className="hint warn">Daily cap reached. New payments wait for your approval until 00:00 UTC.</div>}
        </div>
        <div className="stat"><div className="k">Strikes</div><div className="v">{rein.strikes} <span className="of">of {rein.maxStrikes}</span></div>{rein.strikes >= rein.maxStrikes ? <div className="hint bad">Limit reached. The agent is frozen.</div> : rein.strikes > 0 ? <div className="hint warn">{rein.maxStrikes - rein.strikes} more and it freezes.</div> : null}</div>
        <div className="stat"><div className="k">Per payment</div><div className="v">${fmtUsdc(rein.perPayCap, decimals)}</div></div>
        <div className="stat"><div className="k">Hold ceiling</div><div className="v">${fmtUsdc(rein.holdCeiling, decimals)}</div></div>
        <div className="stat"><div className="k">Expires</div><div className="v sm">{fmtDateTime(rein.expiry)}</div></div>
      </div>

      {isOwner && (
        <HeldPanel reinId={reinId} view={feed.view} decimals={decimals} balance={rein.balance} canAct={w.canAct} account={w.address} onDone={refresh} />
      )}

      <div className="card">
        <h2>Agent</h2>
        <div className="row">
          <a className="mono agent-link" href={addressUrl(rein.agent)} target="_blank" rel="noreferrer">{rein.agent}</a>
          <span>
            {monQ.data ? `${Number(formatUnits(monQ.data.mon, 18)).toFixed(3)} MON` : "…"}
            {paymentsLeft !== undefined && <span className="muted"> · enough gas for ~{paymentsLeft.toString()} payments</span>}
          </span>
        </div>
        {lowGas && (
          <p className="tx tx-err" role="alert">
            <AlertTriangle width={16} height={16} aria-hidden />
            <span>Low gas. The agent needs MON to pay, and Monad charges the full gas limit per call. Send it a little MON: it has less than {GAS_WARN_PAYMENTS.toString()} payments' worth.</span>
          </p>
        )}
      </div>

      <div className="card">
        <h2>Allowed merchants</h2>
        {feed.loading && feed.view.merchants.length === 0 ? (
          <div className="skeleton" style={{ height: 48 }} aria-busy="true" />
        ) : feed.view.merchants.length === 0 ? (
          <p className="card-note">No merchants found.</p>
        ) : (
          <table className="table">
            <tbody>
              {feed.view.merchants.map((m) => (
                <tr key={m.address}>
                  {/* labels are user text: rendered as plain text nodes, never as HTML */}
                  <td>{m.label}{!m.allowed && <span className="muted"> (removed)</span>}</td>
                  <td><a className="mono" href={addressUrl(m.address)} target="_blank" rel="noreferrer">{shortAddr(m.address)}</a></td>
                  <td style={{ textAlign: "right" }}>
                    {isOwner && rein.status !== "Closed" && m.allowed && (
                      <button className="btn ghost small" disabled={!canOwnerAct} onClick={() => write("Remove merchant", { functionName: "setMerchant", args: [reinId, m.address, false, m.label] })}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {isOwner && rein.status !== "Closed" && (
          <div className="actions" style={{ marginTop: 12 }}>
            <div><label htmlFor="m-label">Label</label><input id="m-label" value={mLabel} onChange={(e) => setMLabel(e.target.value)} placeholder="Coffee" /></div>
            <div style={{ flex: 1, minWidth: 200 }}><label htmlFor="m-addr">Address</label><input id="m-addr" value={mAddr} onChange={(e) => setMAddr(cleanAddress(e.target.value))} placeholder="0x…" spellCheck={false} /></div>
            <button className="btn ghost" disabled={!canOwnerAct || !parseAddress(mAddr) || !mLabel.trim()} onClick={addMerchant}>Add merchant</button>
          </div>
        )}
      </div>

      {isOwner && (
        <div className="card">
          <h2>Controls</h2>
          <div className="actions" style={{ marginBottom: 12 }}>
            {rein.status === "Active" && (
              <button className="btn danger" disabled={!canOwnerAct} onClick={() => write("Freeze", { functionName: "freeze", args: [reinId] })}>Freeze agent</button>
            )}
            {rein.status === "Frozen" && (
              <button className="btn good" disabled={!canOwnerAct} onClick={() => write("Unfreeze", { functionName: "unfreeze", args: [reinId] })}>Unfreeze agent</button>
            )}
          </div>
          {rein.status !== "Closed" && (
            <div className="grid2">
              <div className="actions">
                <div style={{ flex: 1 }}><label htmlFor="dep-amt">Deposit ($)</label><input id="dep-amt" inputMode="decimal" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} placeholder="10" /></div>
                <button className="btn" disabled={!canOwnerAct || depositU === null} onClick={deposit}>Deposit</button>
              </div>
              <div className="actions">
                <div style={{ flex: 1 }}><label htmlFor="wd-amt">Withdraw ($)</label><input id="wd-amt" inputMode="decimal" value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} placeholder="10" /></div>
                <button className="btn ghost" disabled={!canOwnerAct || withdrawU === null || withdrawU > rein.balance} onClick={withdraw}>Withdraw</button>
              </div>
            </div>
          )}
          {rein.status !== "Closed" && (
            <p style={{ marginBottom: 0 }}>
              <button
                className="btn ghost small"
                disabled={!canOwnerAct}
                onClick={() => window.confirm("Withdraw everything and close this rein permanently?") && write("Close rein", { functionName: "close", args: [reinId] })}
              >
                Withdraw all &amp; close rein
              </button>
            </p>
          )}
          <TxStatus state={tx.state} />
        </div>
      )}

      <Feed view={feed.view} times={feed.times} decimals={decimals} loading={feed.loading} error={feed.error} onRefresh={refresh} />
    </section>
  );
}
