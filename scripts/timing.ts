// Step 4.4 timing on Monad TESTNET: send N small $1 pays to the News merchant and time each one
// from "send" to "receipt". Run from the repo root.
//
//   npx tsx scripts/timing.ts            PLAN ONLY: reads the chain, prints the plan, sends NOTHING
//   npx tsx scripts/timing.ts --send     executes the plan (real testnet transactions)
//
// Flags:  --send         actually send (without it nothing is sent)
//         --count <n>    number of pays (default 10)
//         --poll <ms>    receipt polling interval (default: the SDK client's own default, printed below)
// Uses AGENT_PRIVATE_KEY + REIN_ID from the root .env (and OWNER_PRIVATE_KEY only if a top-up is needed).
// Testnet only: this script has no mainnet option. Never prints keys.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, formatUnits, parseEventLogs, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PAY_GAS_LIMIT, addresses, chainFor, explorerUrl, getUsdcDecimals, riendaAbi, transportFor } from "@rienda/sdk";
import { createAdminContext, topUpRein } from "./lib/rein-admin.js";

try {
  process.loadEnvFile(".env");
} catch {
  // rely on real env
}

const network = "testnet" as const;
const PAY_USD = "1"; // each pay is $1
const TOP_UP_IF_BELOW = "12"; // top the rein up (to $20) if its balance is below this
const TOP_UP_TO = "20";
const NFR1_P95_MS = 2000; // PRD NFR-1: pay submit -> receipt <= 2 s p95

const { values } = parseArgs({
  options: { send: { type: "boolean", default: false }, count: { type: "string", default: "10" }, poll: { type: "string" } },
  strict: true,
});
const send = values.send === true;
const count = Number(values.count);
if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error("--count must be an integer from 1 to 50");
const pollOverride = values.poll ? Number(values.poll) : undefined;
if (pollOverride !== undefined && !(pollOverride >= 50 && pollOverride <= 10_000)) throw new Error("--poll must be 50 to 10000 ms");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing in root .env`);
  return v;
}
const agentKey = need("AGENT_PRIVATE_KEY");
if (!/^0x[0-9a-fA-F]{64}$/.test(agentKey)) throw new Error("AGENT_PRIVATE_KEY is not a 0x-prefixed 32-byte hex key");
if (!/^\d+$/.test(need("REIN_ID"))) throw new Error("REIN_ID must be a non-negative integer");
const reinId = BigInt(process.env.REIN_ID!);

const news = (JSON.parse(readFileSync(new URL("../agent/merchants.json", import.meta.url), "utf8")).merchants as { key: string; label: string; address: `0x${string}` }[]).find(
  (m) => m.key === "news",
);
if (!news) throw new Error('agent/merchants.json has no merchant with key "news"');

const { rienda, usdc } = addresses[network];
if (!rienda) throw new Error("no testnet deployment recorded");
const chain = chainFor(network);
const transport = transportFor(network, process.env);
const publicClient = createPublicClient({ chain, transport, ...(pollOverride ? { pollingInterval: pollOverride } : {}) });
const agent = privateKeyToAccount(agentKey as `0x${string}`);
const walletClient = createWalletClient({ account: agent, chain, transport });
const decimals = await getUsdcDecimals(publicClient, usdc);
const usd = (u: bigint) => `$${formatUnits(u, decimals)}`;
const amount = parseUnits(PAY_USD, decimals);
const spend = amount * BigInt(count);

// ───────────── preflight (read-only) ─────────────
const rein = await (async () => {
  const r = await publicClient.readContract({ address: rienda, abi: riendaAbi, functionName: "getRein", args: [reinId] });
  return r;
})();
const block = await publicClient.getBlock();
const gasPrice = await publicClient.getGasPrice();
const agentMon = await publicClient.getBalance({ address: agent.address });
const isMerchant = await publicClient.readContract({ address: rienda, abi: riendaAbi, functionName: "isMerchant", args: [reinId, news.address] });
const effectiveSpent = rein.day === block.timestamp / 86_400n ? rein.spentToday : 0n; // contract resets lazily on the next pay
const dailyLeft = rein.dailyCap > effectiveSpent ? rein.dailyCap - effectiveSpent : 0n;
const gasBudget = BigInt(count) * PAY_GAS_LIMIT * gasPrice;
const topUpBelow = parseUnits(TOP_UP_IF_BELOW, decimals);
const needsTopUp = rein.balance < topUpBelow;

const problems: string[] = [];
if (rein.status !== 1) problems.push(`rein #${reinId} is not Active (status ${rein.status}; 2 = Frozen). Run scripts/reset-rein.ts`);
if (rein.agent.toLowerCase() !== agent.address.toLowerCase()) problems.push("AGENT_PRIVATE_KEY is not the agent of this rein");
if (rein.expiry <= block.timestamp) problems.push("rein has expired");
if (!isMerchant) problems.push(`News merchant ${news.address} is not allowed on this rein`);
if (amount > rein.perPayCap) problems.push(`a ${usd(amount)} pay exceeds the per-payment cap ${usd(rein.perPayCap)} (it would be Held, not Paid)`);
if (dailyLeft < spend) problems.push(`daily cap left today is ${usd(dailyLeft)}, less than the ${usd(spend)} this run spends (it would turn into Held)`);
if (rein.openHeld >= 5) problems.push("5 held requests are open; pays would be Blocked. Run scripts/reset-rein.ts");
if (agentMon < gasBudget) problems.push(`agent MON ${formatUnits(agentMon, 18)} is below the ${formatUnits(gasBudget, 18)} MON this run can cost (${count} x ${PAY_GAS_LIMIT} gas x gas price)`);

// ───────────── the plan ─────────────
console.log(`\nTIMING PLAN · ${chain.name} · ${send ? "WILL SEND" : "PLAN ONLY (nothing is sent without --send)"}`);
console.log(`  contract        ${rienda}`);
console.log(`  rein            #${reinId} · ${["None", "Active", "Frozen", "Closed"][rein.status]} · balance ${usd(rein.balance)} · spent today ${usd(effectiveSpent)} of ${usd(rein.dailyCap)}`);
console.log(`  agent           ${agent.address} · ${Number(formatUnits(agentMon, 18)).toFixed(3)} MON`);
console.log(`  payments        ${count} x ${usd(amount)} to ${news.label} ${news.address} (total ${usd(spend)}), memo "timing i/${count}", one at a time`);
console.log(`  gas             fixed limit ${PAY_GAS_LIMIT} per pay; worst-case cost ${Number(formatUnits(gasBudget, 18)).toFixed(4)} MON (Monad charges the limit)`);
console.log(`  measured        per pay: simulate (not timed in the headline), then send -> receipt; median, p95 (nearest-rank), min, max`);
console.log(`  receipt polling ${publicClient.pollingInterval} ms${pollOverride ? " (--poll override)" : " (client default)"} · target: p95 <= ${NFR1_P95_MS} ms (PRD NFR-1)`);
if (publicClient.pollingInterval >= 2000 && !pollOverride) {
  console.log(`  ⚠ polling is ${publicClient.pollingInterval} ms, so each receipt wait is rounded up to a multiple of it: the numbers will mostly measure the poll interval. Set blockTime in packages/sdk/src/chains.ts (or pass --poll 250) for a real measurement.`);
}
console.log(`  top-up          ${needsTopUp ? `rein balance ${usd(rein.balance)} < $${TOP_UP_IF_BELOW}: owner tops it up to $${TOP_UP_TO} first (scripts/lib/rein-admin.ts, same logic as reset-rein)` : `not needed (balance ${usd(rein.balance)} >= $${TOP_UP_IF_BELOW})`}`);

if (needsTopUp && !send && process.env.OWNER_PRIVATE_KEY) {
  console.log("\n  top-up preview (dry-run, nothing sent):");
  const o = await createAdminContext({ network, ownerKey: process.env.OWNER_PRIVATE_KEY, dry: true });
  await topUpRein(o, reinId, TOP_UP_TO);
}
const blocking = problems.filter((p) => !(needsTopUp && /balance/.test(p)));
if (blocking.length) {
  console.error("");
  for (const p of blocking) console.error(`✗ ${p}`);
  process.exit(1);
}
if (!send) {
  console.log("\nPlan only. Nothing was sent. Re-run with --send to execute it.");
  process.exit(0);
}

// ───────────── top-up (real) ─────────────
if (needsTopUp) {
  const o = await createAdminContext({ network, ownerKey: need("OWNER_PRIVATE_KEY"), dry: false });
  if (o.account.address.toLowerCase() !== rein.owner.toLowerCase()) throw new Error("OWNER_PRIVATE_KEY is not the owner of this rein");
  const result = await topUpRein(o, reinId, TOP_UP_TO);
  if (result === "short-of-usdc" || result === "closed") process.exit(1);
}

// ───────────── timed run ─────────────
type Row = { i: number; simMs: number; submitMs: number; receiptMs: number; totalMs: number; outcome: string; tx: string };
const rows: Row[] = [];
console.log(`\nSending ${count} pays...\n   #   simulate  submit  receipt   TOTAL(send->receipt)  outcome`);
for (let i = 1; i <= count; i++) {
  const memo = `timing ${i}/${count}`;
  const args = [reinId, news.address, amount, memo] as const;
  const t0 = performance.now();
  const { request } = await publicClient.simulateContract({ address: rienda, abi: riendaAbi, functionName: "pay", args, account: agent, gas: PAY_GAS_LIMIT });
  const t1 = performance.now(); // send starts here
  const hash = await walletClient.writeContract({ ...request, gas: PAY_GAS_LIMIT });
  const t2 = performance.now();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const t3 = performance.now();
  if (receipt.status !== "success") throw new Error(`pay ${i} reverted onchain: ${explorerUrl(network, "tx", hash)}`);
  const ev = parseEventLogs({ abi: riendaAbi, logs: receipt.logs }).find((l) => l.eventName === "Paid" || l.eventName === "Held" || l.eventName === "Blocked");
  const outcome = ev?.eventName ?? "?";
  const row: Row = { i, simMs: t1 - t0, submitMs: t2 - t1, receiptMs: t3 - t2, totalMs: t3 - t1, outcome, tx: hash };
  rows.push(row);
  console.log(`  ${String(i).padStart(2)}  ${row.simMs.toFixed(0).padStart(7)}  ${row.submitMs.toFixed(0).padStart(6)}  ${row.receiptMs.toFixed(0).padStart(7)}   ${row.totalMs.toFixed(0).padStart(8)} ms          ${outcome}  ${explorerUrl(network, "tx", hash)}`);
  if (outcome !== "Paid") {
    console.error(`\n✗ pay ${i} was ${outcome}, not Paid: stopping so the run doesn't burn strikes or balance.`);
    break;
  }
}

// ───────────── stats ─────────────
const totals = rows.map((r) => r.totalMs).sort((a, b) => a - b);
const n = totals.length;
if (n > 0) {
  const median = n % 2 ? totals[(n - 1) / 2]! : (totals[n / 2 - 1]! + totals[n / 2]!) / 2;
  const p95 = totals[Math.ceil(0.95 * n) - 1]!;
  const mean = totals.reduce((a, b) => a + b, 0) / n;
  console.log(`\nsend -> receipt over ${n} pays:  median ${median.toFixed(0)} ms · p95 ${p95.toFixed(0)} ms (nearest-rank) · min ${totals[0]!.toFixed(0)} · max ${totals[n - 1]!.toFixed(0)} · mean ${mean.toFixed(0)}`);
  console.log(`receipt polling interval: ${publicClient.pollingInterval} ms · NFR-1 target p95 <= ${NFR1_P95_MS} ms: ${p95 <= NFR1_P95_MS ? "MET" : "NOT MET"}`);
  if (n < 20) console.log(`note: with only ${n} samples the nearest-rank p95 is the ${n === 10 ? "slowest" : "near-slowest"} pay.`);
}
const after = await publicClient.readContract({ address: rienda, abi: riendaAbi, functionName: "getRein", args: [reinId] });
console.log(`rein #${reinId} after: balance ${usd(after.balance)} · spent today ${usd(after.spentToday)} · strikes ${after.strikes}/${after.maxStrikes}`);
process.exit(rows.length === count && rows.every((r) => r.outcome === "Paid") ? 0 : 1);
