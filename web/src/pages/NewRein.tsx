import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi, getAddress, isAddress, parseEventLogs, zeroAddress } from "viem";
import { DEFAULT_LIMITS, MAX_STRIKES_LIMIT, riendaAbi } from "@rienda/sdk";
import merchantsFile from "../../../agent/merchants.json";
import { NETWORK, RIENDA, USDC, chain, publicClient } from "../config";
import { useDecimals, useWallet } from "../hooks";
import { useTx } from "../lib/tx";
import { fmtUsdc, parseUsdc } from "../lib/format";
import { TxStatus } from "../components/TxStatus";
import { navigate } from "../router";

type MerchantRow = { address: string; label: string };

// Prefill from the demo merchants only on testnet; on mainnet the owner enters real merchants.
const PREFILL: MerchantRow[] =
  NETWORK === "testnet"
    ? merchantsFile.merchants.filter((m) => isAddress(m.address)).map((m) => ({ address: m.address, label: m.label }))
    : [{ address: "", label: "" }];

type Stage = "idle" | "approve" | "create" | "done";

export function NewRein() {
  const w = useWallet();
  const decimals = useDecimals();
  const tx = useTx();

  const [agent, setAgent] = useState("");
  const [perPay, setPerPay] = useState<string>(DEFAULT_LIMITS.perPayCap);
  const [daily, setDaily] = useState<string>(DEFAULT_LIMITS.dailyCap);
  const [ceiling, setCeiling] = useState<string>(DEFAULT_LIMITS.holdCeiling);
  const [strikes, setStrikes] = useState<string>(String(DEFAULT_LIMITS.maxStrikes));
  const [days, setDays] = useState<string>(String(DEFAULT_LIMITS.expiryDays));
  const [deposit, setDeposit] = useState("30");
  const [merchants, setMerchants] = useState<MerchantRow[]>(PREFILL);
  const [stage, setStage] = useState<Stage>("idle");
  const [skippedApprove, setSkippedApprove] = useState(false);

  const balance = useQuery({
    queryKey: ["usdc-balance", w.address],
    enabled: w.isConnected,
    queryFn: () => publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [w.address!] }),
  });

  // ── validation: the same rules as the contract (FR-2) ──
  const errors: string[] = [];
  const perPayU = parseUsdc(perPay, decimals);
  const dailyU = parseUsdc(daily, decimals);
  const ceilingU = parseUsdc(ceiling, decimals);
  const depositU = deposit.trim() === "0" ? 0n : parseUsdc(deposit, decimals);
  const strikesN = Number(strikes);
  const daysN = Number(days);

  if (!isAddress(agent) || agent.toLowerCase() === zeroAddress) errors.push("Agent must be a valid address.");
  else if (w.address && agent.toLowerCase() === w.address.toLowerCase()) errors.push("The agent can't be your owner wallet.");
  if (perPayU === null) errors.push("Per-payment cap must be greater than 0.");
  if (dailyU === null) errors.push("Daily cap must be greater than 0.");
  if (ceilingU === null) errors.push("Hold ceiling must be greater than 0.");
  if (perPayU !== null && dailyU !== null && perPayU > dailyU) errors.push("Per-payment cap can't be above the daily cap.");
  if (perPayU !== null && ceilingU !== null && perPayU > ceilingU) errors.push("Per-payment cap can't be above the hold ceiling.");
  if (!Number.isInteger(strikesN) || strikesN < 1 || strikesN > MAX_STRIKES_LIMIT) errors.push(`Max strikes must be 1 to ${MAX_STRIKES_LIMIT}.`);
  if (!Number.isInteger(daysN) || daysN < 1) errors.push("Expiry must be at least 1 day.");
  if (depositU === null) errors.push("Deposit must be 0 or a positive amount.");
  else if (balance.data !== undefined && depositU > balance.data) {
    errors.push(`Deposit is more than your USDC balance ($${fmtUsdc(balance.data, decimals)}).`);
  }
  const seen = new Set<string>();
  merchants.forEach((m, i) => {
    if (!isAddress(m.address) || m.address.toLowerCase() === zeroAddress) errors.push(`Merchant ${i + 1}: invalid address.`);
    else {
      const lower = m.address.toLowerCase();
      if (seen.has(lower)) errors.push(`Merchant ${i + 1}: duplicate address.`);
      seen.add(lower);
      if (lower === agent.toLowerCase() || lower === w.address?.toLowerCase()) errors.push(`Merchant ${i + 1}: can't be the agent or owner.`);
    }
    if (!m.label.trim()) errors.push(`Merchant ${i + 1}: add a label.`);
  });
  if (merchants.length === 0) errors.push("Add at least one merchant: only listed merchants can ever be paid.");

  const busy = tx.busy;
  const canSubmit = w.canAct && errors.length === 0 && !busy && !!RIENDA && stage !== "done";

  async function submit() {
    if (!canSubmit || !w.address || !RIENDA) return;
    const owner = w.address;
    const contract = RIENDA; // narrowed const, usable inside callbacks
    try {
      // 1. approve (skipped when the allowance already covers the deposit)
      const need = depositU ?? 0n;
      const allowance = await publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, RIENDA],
      });
      if (need > 0n && allowance < need) {
        setStage("approve");
        setSkippedApprove(false);
        await tx.run("Approve USDC", { address: USDC, abi: erc20Abi, functionName: "approve", args: [RIENDA, need], chainId: chain.id }, owner);
      } else {
        setSkippedApprove(true);
      }

      // 2. createRein
      setStage("create");
      const block = await publicClient.getBlock();
      const expiry = block.timestamp + BigInt(daysN) * 86_400n;
      const receipt = await tx.run(
        "Create rein",
        {
          address: RIENDA,
          abi: riendaAbi,
          functionName: "createRein",
          args: [
            { agent: getAddress(agent), perPayCap: perPayU!, dailyCap: dailyU!, holdCeiling: ceilingU!, expiry, maxStrikes: strikesN },
            merchants.map((m) => getAddress(m.address)),
            merchants.map((m) => m.label.trim()),
            need,
          ],
          chainId: chain.id,
        },
        owner,
      );
      const created = parseEventLogs({ abi: riendaAbi, logs: receipt.logs, eventName: "ReinCreated" }).find(
        (l) => l.address.toLowerCase() === contract.toLowerCase(),
      );
      if (!created) throw new Error("Rein created but no ReinCreated event found. Check My reins.");
      setStage("done");
      navigate(`/rein/${created.args.reinId}`);
    } catch {
      setStage("idle"); // error is shown by TxStatus; the form stays filled so the owner can retry
    }
  }

  const setMerchant = (i: number, patch: Partial<MerchantRow>) =>
    setMerchants((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  return (
    <section>
      <h1>New rein</h1>
      <p className="muted">
        Your agent can pay only the merchants below, within these limits. Funds stay in the Rienda contract until a payment is allowed.
      </p>

      <div className="card">
        <h2>Agent</h2>
        <div className="field">
          <label htmlFor="agent">Agent wallet address (holds only MON for gas)</label>
          <input id="agent" value={agent} onChange={(e) => setAgent(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
        </div>
      </div>

      <div className="card">
        <h2>Limits (USDC)</h2>
        <div className="grid2">
          <div className="field"><label htmlFor="pp">Per-payment cap ($)</label><input id="pp" inputMode="decimal" value={perPay} onChange={(e) => setPerPay(e.target.value)} /></div>
          <div className="field"><label htmlFor="dc">Daily cap ($)</label><input id="dc" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} /></div>
          <div className="field"><label htmlFor="hc">Hold ceiling ($)</label><input id="hc" inputMode="decimal" value={ceiling} onChange={(e) => setCeiling(e.target.value)} /></div>
          <div className="field"><label htmlFor="ms">Max strikes</label><input id="ms" inputMode="numeric" value={strikes} onChange={(e) => setStrikes(e.target.value)} /></div>
          <div className="field"><label htmlFor="ex">Expiry (days)</label><input id="ex" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></div>
        </div>
        <p className="muted">
          Above the per-payment cap (or over the daily cap) a payment waits for your approval. Above the hold ceiling, or to anyone not
          listed, it's blocked and counts as a strike.
        </p>
      </div>

      <div className="card">
        <h2>Allowed merchants</h2>
        {merchants.map((m, i) => (
          <div className="grid2" key={i} style={{ gridTemplateColumns: "1fr 2fr auto", alignItems: "end", marginBottom: 8 }}>
            <div><label>Label</label><input value={m.label} onChange={(e) => setMerchant(i, { label: e.target.value })} placeholder="News API" /></div>
            <div><label>Address</label><input value={m.address} onChange={(e) => setMerchant(i, { address: e.target.value.trim() })} placeholder="0x…" spellCheck={false} /></div>
            <button className="ghost" onClick={() => setMerchants((ms) => ms.filter((_, j) => j !== i))} aria-label={`Remove merchant ${i + 1}`}>Remove</button>
          </div>
        ))}
        <button className="ghost" onClick={() => setMerchants((ms) => [...ms, { address: "", label: "" }])}>Add merchant</button>
      </div>

      <div className="card">
        <h2>Deposit</h2>
        <div className="field" style={{ maxWidth: 240 }}>
          <label htmlFor="dep">Deposit ($)</label>
          <input id="dep" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
        </div>
        <p className="muted">
          Your USDC balance: {balance.data !== undefined ? `$${fmtUsdc(balance.data, decimals)}` : w.isConnected ? "…" : "connect a wallet"}
        </p>
      </div>

      {errors.length > 0 && w.isConnected && (
        <ul className="tx tx-err" style={{ paddingLeft: 18 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}

      <div className="card">
        <h2>Create</h2>
        <ol style={{ paddingLeft: 18, margin: "0 0 12px" }}>
          <li>
            Approve USDC{" "}
            <span className="muted">
              {skippedApprove ? "(skipped, allowance is enough)" : stage === "approve" ? "(in progress)" : stage === "create" || stage === "done" ? "(done)" : ""}
            </span>
          </li>
          <li>
            Create rein <span className="muted">{stage === "create" ? "(in progress)" : stage === "done" ? "(done)" : ""}</span>
          </li>
        </ol>
        <button onClick={submit} disabled={!canSubmit}>
          {busy ? "Working…" : "Approve & create rein"}
        </button>
        {!w.canAct && <p className="muted">{w.isConnected ? "Switch to Monad to continue." : "Connect your wallet to continue."}</p>}
        <TxStatus state={tx.state} />
      </div>
    </section>
  );
}
