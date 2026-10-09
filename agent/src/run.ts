// CLI: npm run agent -- [--mode scripted] --scenario normal|injection --network testnet|mainnet
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, formatUnits, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  PAY_GAS_LIMIT,
  addresses,
  chainFor,
  createRienda,
  getUsdcDecimals,
  transportFor,
  type Network,
} from "@rienda/sdk";
import { AGENT_DIR, loadAgentEnv } from "./env.js";
import { bold, dim, red, yellow, log } from "./log.js";
import { printSummary, runScripted } from "./scripted.js";
import { createTools, type Merchant } from "./tools.js";
import { injection } from "../scenarios/injection.js";
import { normal } from "../scenarios/normal.js";

const USAGE = "usage: npm run agent -- [--mode scripted] --scenario normal|injection --network testnet|mainnet";

function die(msg: string, code = 1): never {
  console.error(red(`✗ ${msg}`));
  process.exit(code);
}

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "scripted" },
    scenario: { type: "string" },
    network: { type: "string", default: "testnet" },
    "confirm-mainnet": { type: "boolean", default: false },
  },
  strict: true,
});

const mode = values.mode;
const scenarioName = values.scenario;
const network = values.network as Network;
if (mode !== "scripted") die(`--mode must be scripted (the only mode)\n${USAGE}`);
if (scenarioName !== "normal" && scenarioName !== "injection") die(`--scenario must be normal or injection\n${USAGE}`);
if (network !== "testnet" && network !== "mainnet") die(`--network must be testnet or mainnet\n${USAGE}`);
if (network === "mainnet" && !values["confirm-mainnet"]) {
  die("mainnet sends real money. Re-run with --confirm-mainnet only after the owner has said go.");
}

let env;
try {
  env = loadAgentEnv();
} catch (e) {
  die((e as Error).message);
}

const deployment = addresses[network];
if (!deployment.rienda) die(`No Rienda deployment recorded for ${network} in packages/sdk/src/addresses.ts`);

// merchants.json (placeholders are rejected)
const merchants: Merchant[] = JSON.parse(readFileSync(`${AGENT_DIR}merchants.json`, "utf8")).merchants;
for (const m of merchants) {
  if (!isAddress(m.address)) die(`agent/merchants.json: "${m.label}" has no valid address yet`);
}
const merchant = (key: string): Merchant => {
  const m = merchants.find((x) => x.key === key);
  if (!m) throw new Error(`merchant "${key}" not in agent/merchants.json`);
  return m;
};

// clients
const account = privateKeyToAccount(env.agentKey);
const chain = chainFor(network);
const transport = transportFor(network, env.raw);
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ account, chain, transport });
const rienda = createRienda({ address: deployment.rienda, publicClient, walletClient });
const decimals = await getUsdcDecimals(publicClient, deployment.usdc);

const tools = createTools({
  rienda,
  network,
  reinId: env.reinId,
  decimals,
  merchants,
  attacker: env.attacker,
  now: async () => (await publicClient.getBlock()).timestamp,
});

// ── preflight: refuse to start from a state that would make the run meaningless ──
const mon = await publicClient.getBalance({ address: account.address });
const rein = await rienda.getRein(env.reinId);
log.line(bold(`Rienda agent · ${chain.name} · rein #${env.reinId}`));
log.line(dim(`agent ${account.address} · MON ${formatUnits(mon, 18)} · pay gas limit ${PAY_GAS_LIMIT}`));

const problems: string[] = [];
if (rein.status === "None") problems.push(`rein #${env.reinId} does not exist`);
else {
  if (rein.agent.toLowerCase() !== account.address.toLowerCase()) problems.push("this key is not the agent of that rein");
  if (rein.status !== "Active") problems.push(`rein is ${rein.status}. Owner must unfreeze it (npx tsx scripts/reset-rein.ts)`);
  if (rein.strikes !== 0) problems.push(`rein already has ${rein.strikes} strike(s). Owner: npx tsx scripts/reset-rein.ts`);
  if (rein.openHeld >= 5) problems.push("5 held requests already open. Owner: npx tsx scripts/reset-rein.ts");
  if (rein.expiry <= (await publicClient.getBlock()).timestamp) problems.push("rein has expired");
}
if (mon === 0n) problems.push("agent has no MON for gas");
if (scenarioName === "injection" && rein.status !== "None") {
  const today = (await publicClient.getBlock()).timestamp / 86_400n;
  const spent = rein.day === today ? rein.spentToday : 0n;
  if (rein.dailyCap - spent < 6n * 10n ** BigInt(decimals)) problems.push("less than $6 of daily cap left; wait for UTC midnight or raise dailyCap");
  if (rein.balance < 6n * 10n ** BigInt(decimals)) problems.push("rein balance is below $6; deposit more USDC");
}
if (problems.length) {
  for (const p of problems) console.error(red(`✗ ${p}`));
  process.exit(1);
}
if (rein.balance < 18n * 10n ** BigInt(decimals)) {
  log.line(yellow(`note: balance is ${formatUnits(rein.balance, decimals)} USDC; approving the $12 held request later needs more`));
}

const scenario = scenarioName === "injection" ? injection : normal;
const rows = await runScripted(scenario, tools, { merchant, attacker: env.attacker });
printSummary(rows);

if (scenarioName === "injection") {
  const after = await rienda.getRein(env.reinId);
  log.line(dim(`\nrein after: status ${after.status} · balance ${formatUnits(after.balance, decimals)} USDC · strikes ${after.strikes}/${after.maxStrikes} · open held ${after.openHeld}`));
}
process.exit(rows.every((r) => r.ok) ? 0 : 1);
