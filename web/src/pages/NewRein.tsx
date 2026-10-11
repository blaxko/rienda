import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi, isAddress, parseEventLogs } from "viem";
import { DEFAULT_LIMITS, MAX_STRIKES_LIMIT, riendaAbi } from "@rienda/sdk";
import merchantsFile from "../../../agent/merchants.json";
import { NETWORK, RIENDA, USDC, chain, publicClient } from "../config";
import { useDecimals, useWallet } from "../hooks";
import { useTx } from "../lib/tx";
import { fmtUsdc, parseUsdc } from "../lib/format";
import { cleanAddress, parseAddress } from "../lib/address";
import { TxStatus } from "../components/TxStatus";
import { Link, navigate } from "../router";

type MerchantRow = { address: string; label: string };

// Prefill from the demo merchants only on testnet; on mainnet the owner enters real merchants.
const PREFILL: MerchantRow[] =
  NETWORK === "testnet"
    ? merchantsFile.merchants.filter((m) => isAddress(m.address, { strict: false })).map((m) => ({ address: m.address, label: m.label }))
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
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (id: string) => setTouched((t) => (t[id] ? t : { ...t, [id]: true }));
  const [stage, setStage] = useState<Stage>("idle");
  const [skippedApprove, setSkippedApprove] = useState(false);

  const balance = useQuery({
    queryKey: ["usdc-balance", w.address],
    enabled: w.isConnected,
    queryFn: () => publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [w.address!] }),
  });

  // ── validation: the same rules as the contract (FR-2). Each issue names the field it belongs to. ──
  type Issue = { field: string; msg: string };
  const issues: Issue[] = [];
  const bad = (field: string, msg: string) => issues.push({ field, msg });
  const perPayU = parseUsdc(perPay, decimals);
  const dailyU = parseUsdc(daily, decimals);
  const ceilingU = parseUsdc(ceiling, decimals);
  const depositU = deposit.trim() === "0" ? 0n : parseUsdc(deposit, decimals);
  const strikesN = Number(strikes);
  const daysN = Number(days);
  const agentA = parseAddress(agent);

  if (agent.trim() === "") bad("agent", "Agent: enter the agent wallet address.");
  else if (!agentA) bad("agent", "Agent: not a valid address (0x followed by 40 hex characters).");
  else if (w.address && agentA.toLowerCase() === w.address.toLowerCase()) bad("agent", "Agent: it can't be your owner wallet.");
  if (perPayU === null) bad("pp", "Per-payment cap: must be greater than 0.");
  if (dailyU === null) bad("dc", "Daily cap: must be greater than 0.");
  if (ceilingU === null) bad("hc", "Hold ceiling: must be greater than 0.");
  if (perPayU !== null && dailyU !== null && perPayU > dailyU) bad("pp", "Per-payment cap: can't be above the daily cap.");
  if (perPayU !== null && ceilingU !== null && perPayU > ceilingU) bad("pp", "Per-payment cap: can't be above the hold ceiling.");
  if (!Number.isInteger(strikesN) || strikesN < 1 || strikesN > MAX_STRIKES_LIMIT) bad("ms", `Max strikes: must be 1 to ${MAX_STRIKES_LIMIT}.`);
  if (!Number.isInteger(daysN) || daysN < 1) bad("ex", "Expiry: at least 1 day.");
  if (depositU === null) bad("dep", "Deposit: 0 or a positive amount.");
  else if (balance.data !== undefined && depositU > balance.data) {
    bad("dep", `Deposit: more than your USDC balance ($${fmtUsdc(balance.data, decimals)}).`);
  }
  const seen = new Set<string>();
  merchants.forEach((m, i) => {
    const addr = parseAddress(m.address);
    if (!addr) bad(`ma-${i}`, `Merchant ${i + 1}: ${m.address.trim() === "" ? "enter an address" : "not a valid address"}.`);
    else {
      const lower = addr.toLowerCase();
      if (seen.has(lower)) bad(`ma-${i}`, `Merchant ${i + 1}: duplicate address.`);
      seen.add(lower);
      if (lower === agentA?.toLowerCase() || lower === w.address?.toLowerCase()) bad(`ma-${i}`, `Merchant ${i + 1}: can't be the agent or owner.`);
    }
    if (!m.label.trim()) bad(`ml-${i}`, `Merchant ${i + 1}: add a label.`);
  });
  if (merchants.length === 0) bad("merchants", "Merchants: add at least one. Only listed merchants can ever be paid.");
  const errors = issues.map((i) => i.msg);
  const fieldError = (id: string) => issues.find((i) => i.field === id)?.msg.replace(/^[^:]+: /, "");
  /** props for an input: invalid state + the inline message once the field was touched */
  const fp = (id: string) => {
    const msg = touched[id] ? fieldError(id) : undefined;
    return { id, onBlur: () => touch(id), "aria-invalid": msg ? true : undefined, "aria-describedby": msg ? `${id}-err` : undefined } as const;
  };
  const Err = ({ id }: { id: string }) => (touched[id] && fieldError(id) ? <div className="field-error" id={`${id}-err`} role="alert">{fieldError(id)}</div> : null);
  // things that block the button but aren't a field
  const blockers: string[] = [];
  if (!RIENDA) blockers.push("Rienda isn't deployed on this network.");
  if (!w.isConnected) blockers.push("Connect your wallet.");
  else if (!w.canAct) blockers.push("Switch your wallet to Monad Testnet.");

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
            { agent: agentA!, perPayCap: perPayU!, dailyCap: dailyU!, holdCeiling: ceilingU!, expiry, maxStrikes: strikesN },
            merchants.map((m) => parseAddress(m.address)!),
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
      <Link to="/app" className="back">My reins</Link>
      <div className="page-head">
        <h1>New rein</h1>
        <p className="lede">Your agent can pay only the merchants below, within these limits. Funds stay in the Rienda contract until a payment is allowed.</p>
      </div>

      <div className="card">
        <h2>Agent</h2>
        <div className="field">
          <label htmlFor="agent">Agent wallet address (holds only MON for gas)</label>
          <input {...fp("agent")} value={agent} onChange={(e) => { touch("agent"); setAgent(cleanAddress(e.target.value)); }} placeholder="0x…" spellCheck={false} autoComplete="off" autoCapitalize="off" />
          <Err id="agent" />
        </div>
      </div>

      <div className="card">
        <h2>Limits (USDC)</h2>
        <div className="grid2">
          <div className="field"><label htmlFor="pp">Per-payment cap ($)</label><input {...fp("pp")} inputMode="decimal" value={perPay} onChange={(e) => { touch("pp"); setPerPay(e.target.value); }} /><Err id="pp" /></div>
          <div className="field"><label htmlFor="dc">Daily cap ($)</label><input {...fp("dc")} inputMode="decimal" value={daily} onChange={(e) => { touch("dc"); setDaily(e.target.value); }} /><Err id="dc" /></div>
          <div className="field"><label htmlFor="hc">Hold ceiling ($)</label><input {...fp("hc")} inputMode="decimal" value={ceiling} onChange={(e) => { touch("hc"); setCeiling(e.target.value); }} /><Err id="hc" /></div>
          <div className="field"><label htmlFor="ms">Max strikes</label><input {...fp("ms")} inputMode="numeric" value={strikes} onChange={(e) => { touch("ms"); setStrikes(e.target.value); }} /><Err id="ms" /></div>
          <div className="field"><label htmlFor="ex">Expiry (days)</label><input {...fp("ex")} inputMode="numeric" value={days} onChange={(e) => { touch("ex"); setDays(e.target.value); }} /><Err id="ex" /></div>
        </div>
        <p className="card-note">
          Above the per-payment cap (or over the daily cap) a payment waits for your approval. Above the hold ceiling, or to anyone not
          listed, it's blocked and counts as a strike.
        </p>
      </div>

      <div className="card">
        <h2>Allowed merchants</h2>
        {merchants.map((m, i) => (
          <div className="merchant-row" key={i}>
            <div><label htmlFor={`ml-${i}`}>Label</label><input {...fp(`ml-${i}`)} value={m.label} onChange={(e) => { touch(`ml-${i}`); setMerchant(i, { label: e.target.value }); }} placeholder="News API" /><Err id={`ml-${i}`} /></div>
            <div><label htmlFor={`ma-${i}`}>Address</label><input {...fp(`ma-${i}`)} value={m.address} onChange={(e) => { touch(`ma-${i}`); setMerchant(i, { address: cleanAddress(e.target.value) }); }} placeholder="0x…" spellCheck={false} autoComplete="off" autoCapitalize="off" /><Err id={`ma-${i}`} /></div>
            <button className="btn ghost" onClick={() => setMerchants((ms) => ms.filter((_, j) => j !== i))} aria-label={`Remove merchant ${i + 1}`}>Remove</button>
          </div>
        ))}
        <button className="btn ghost" onClick={() => setMerchants((ms) => [...ms, { address: "", label: "" }])}>Add merchant</button>
      </div>

      <div className="card">
        <h2>Deposit</h2>
        <div className="field" style={{ maxWidth: 240 }}>
          <label htmlFor="dep">Deposit ($)</label>
          <input {...fp("dep")} inputMode="decimal" value={deposit} onChange={(e) => { touch("dep"); setDeposit(e.target.value); }} />
          <Err id="dep" />
        </div>
        <p className="card-note">
          Your USDC balance: {balance.data !== undefined ? `$${fmtUsdc(balance.data, decimals)}` : w.isConnected ? "…" : "connect a wallet"}
        </p>
      </div>

      <div className="card">
        <h2>Create</h2>
        <ol className="steps-list">
          <li className={stage === "approve" ? "on" : stage === "create" || stage === "done" || skippedApprove ? "done" : ""}>
            <span className="dot">{stage === "create" || stage === "done" || skippedApprove ? "✓" : "1"}</span>
            Approve USDC{skippedApprove ? " (not needed)" : ""}
          </li>
          <li className={stage === "create" ? "on" : stage === "done" ? "done" : ""}>
            <span className="dot">{stage === "done" ? "✓" : "2"}</span>
            Create rein
          </li>
        </ol>
        <button className="btn" onClick={submit} disabled={!canSubmit} aria-describedby={!canSubmit ? "why-disabled" : undefined}>
          {busy ? "Working…" : "Approve & create rein"}
        </button>
        {!canSubmit && !busy && stage !== "done" && (blockers.length > 0 || errors.length > 0) && (
          <div className="why-disabled" id="why-disabled">
            <strong>Not ready yet:</strong>
            <ul>{[...blockers, ...errors].map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        )}
        <TxStatus state={tx.state} />
      </div>
    </section>
  );
}
