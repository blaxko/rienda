import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { erc20Abi, formatUnits, getAddress, isAddress } from "viem";
import { PAY_GAS_LIMIT, riendaAbi } from "@rienda/sdk";
import { RIENDA, USDC, addressUrl, chain, publicClient, rienda } from "../config";
import { useDecimals, useWallet } from "../hooks";
import { useReinFeed } from "../lib/useReinFeed";
import { useTx } from "../lib/tx";
import { fmtDateTime, fmtUsdc, parseUsdc, shortAddr } from "../lib/format";
import { TxStatus } from "../components/TxStatus";
import { Feed } from "../components/Feed";
import { HeldPanel } from "../components/HeldPanel";
import { Link } from "../router";

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

  if (!rienda) return <p>Rienda is not deployed on {chain.name}.</p>;
  if (reinQ.isLoading) return <p className="muted">Loading rein #{reinId.toString()}…</p>;
  if (reinQ.error) return <p className="tx tx-err">Could not load the rein: {(reinQ.error as Error).message}</p>;
  if (!rein || rein.status === "None") {
    return (
      <section>
        <h1>Rein #{reinId.toString()}</h1>
        <p className="muted">This rein doesn't exist. <Link to="/">Back to my reins</Link></p>
      </section>
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
    if (!isAddress(mAddr) || !mLabel.trim()) return;
    await write("Add merchant", { functionName: "setMerchant", args: [reinId, getAddress(mAddr), true, mLabel.trim()] });
    setMAddr("");
    setMLabel("");
  }

  const depositU = parseUsdc(depositAmt, decimals);
  const withdrawU = parseUsdc(withdrawAmt, decimals);

  return (
    <section>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Rein #{reinId.toString()}</h1>
        <span className={`status status-${rein.status}`}>{rein.status}</span>
      </div>

      {rein.status === "Frozen" && (
        <div className="frozen-banner" role="alert">
          FROZEN
          <small>
            {autoFrozen
              ? `Rienda froze this agent after ${rein.maxStrikes} blocked attempts. Your funds didn't move.`
              : "You froze this agent. It can't pay until you unfreeze it."}
          </small>
        </div>
      )}
      {rein.status === "Closed" && <div className="banner banner-amber" style={{ marginBottom: 16 }}>This rein is closed.</div>}
      {expired && rein.status !== "Closed" && <div className="banner banner-amber" style={{ marginBottom: 16 }}>This rein has expired: the agent can't pay.</div>}
      {w.isConnected && !isOwner && <div className="banner banner-amber" style={{ marginBottom: 16 }}>You're viewing someone else's rein. Controls are disabled.</div>}

      <div className="stats">
        <div className="stat"><div className="k">Balance</div><div className="v">${fmtUsdc(rein.balance, decimals)}</div></div>
        <div className="stat">
          <div className="k">Spent today</div>
          <div className="v">${fmtUsdc(spentToday, decimals)} <span className="muted" style={{ fontSize: ".8rem", fontWeight: 400 }}>/ ${fmtUsdc(rein.dailyCap, decimals)}</span></div>
          <div className={`meter ${spentPct >= 80 ? "hot" : ""}`}><div style={{ width: `${spentPct}%` }} /></div>
        </div>
        <div className="stat"><div className="k">Strikes</div><div className="v">{rein.strikes} of {rein.maxStrikes}</div></div>
        <div className="stat"><div className="k">Per payment</div><div className="v">${fmtUsdc(rein.perPayCap, decimals)}</div></div>
        <div className="stat"><div className="k">Hold ceiling</div><div className="v">${fmtUsdc(rein.holdCeiling, decimals)}</div></div>
        <div className="stat"><div className="k">Expires</div><div className="v" style={{ fontSize: ".95rem" }}>{fmtDateTime(rein.expiry)}</div></div>
      </div>

      {isOwner && (
        <HeldPanel reinId={reinId} view={feed.view} decimals={decimals} balance={rein.balance} canAct={w.canAct} account={w.address} onDone={refresh} />
      )}

      <div className="card">
        <h2>Agent</h2>
        <div className="row">
          <a className="mono" href={addressUrl(rein.agent)} target="_blank" rel="noreferrer">{rein.agent}</a>
          <span>
            {monQ.data ? `${Number(formatUnits(monQ.data.mon, 18)).toFixed(3)} MON` : "…"}
            {paymentsLeft !== undefined && <span className="muted"> · enough gas for ~{paymentsLeft.toString()} payments</span>}
          </span>
        </div>
        {lowGas && (
          <p className="tx tx-err">
            Low gas: the agent needs MON to pay. Monad charges the full gas limit per call, so send it a little MON (below {GAS_WARN_PAYMENTS.toString()} payments' worth).
          </p>
        )}
      </div>

      <div className="card">
        <h2>Allowed merchants</h2>
        {feed.loading && feed.view.merchants.length === 0 ? (
          <p className="muted">Loading…</p>
        ) : feed.view.merchants.length === 0 ? (
          <p className="muted">No merchants found.</p>
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
                      <button className="ghost small" disabled={!canOwnerAct} onClick={() => write("Remove merchant", { functionName: "setMerchant", args: [reinId, m.address, false, m.label] })}>
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
            <div><label>Label</label><input value={mLabel} onChange={(e) => setMLabel(e.target.value)} placeholder="Coffee" /></div>
            <div style={{ flex: 1, minWidth: 200 }}><label>Address</label><input value={mAddr} onChange={(e) => setMAddr(e.target.value.trim())} placeholder="0x…" spellCheck={false} /></div>
            <button className="ghost" disabled={!canOwnerAct || !isAddress(mAddr) || !mLabel.trim()} onClick={addMerchant}>Add merchant</button>
          </div>
        )}
      </div>

      {isOwner && (
        <div className="card">
          <h2>Controls</h2>
          <div className="actions" style={{ marginBottom: 12 }}>
            {rein.status === "Active" && (
              <button className="danger" disabled={!canOwnerAct} onClick={() => write("Freeze", { functionName: "freeze", args: [reinId] })}>Freeze agent</button>
            )}
            {rein.status === "Frozen" && (
              <button className="good" disabled={!canOwnerAct} onClick={() => write("Unfreeze", { functionName: "unfreeze", args: [reinId] })}>Unfreeze agent</button>
            )}
          </div>
          {rein.status !== "Closed" && (
            <div className="grid2">
              <div className="actions">
                <div style={{ flex: 1 }}><label>Deposit ($)</label><input inputMode="decimal" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} placeholder="10" /></div>
                <button disabled={!canOwnerAct || depositU === null} onClick={deposit}>Deposit</button>
              </div>
              <div className="actions">
                <div style={{ flex: 1 }}><label>Withdraw ($)</label><input inputMode="decimal" value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} placeholder="10" /></div>
                <button className="ghost" disabled={!canOwnerAct || withdrawU === null || withdrawU > rein.balance} onClick={withdraw}>Withdraw</button>
              </div>
            </div>
          )}
          {rein.status !== "Closed" && (
            <p style={{ marginBottom: 0 }}>
              <button
                className="ghost small"
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
