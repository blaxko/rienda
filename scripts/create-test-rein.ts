// Creates a test rein on Monad TESTNET: approve 30 USDC, then createRein with the demo limits.
// Run from the repo root:  npx tsx scripts/create-test-rein.ts
// Needs a built SDK (npm run build -w packages/sdk) and a filled-in .env + agent/merchants.json.
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, isAddress, parseEventLogs, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_LIMITS,
  addresses,
  chainFor,
  explorerUrl,
  getUsdcDecimals,
  riendaAbi,
  transportFor,
} from "@rienda/sdk";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env file: fall through to real environment variables
}

const network = "testnet" as const; // mainnet needs the owner's explicit go-ahead; this script refuses it
const DEPOSIT = "30"; // USDC

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ── inputs ──
const ownerKey = process.env.OWNER_PRIVATE_KEY;
if (!ownerKey || !/^0x[0-9a-fA-F]{64}$/.test(ownerKey)) {
  fail("OWNER_PRIVATE_KEY missing or not a 0x-prefixed 32-byte hex key (check .env)");
}
const agentAddress = process.env.AGENT_ADDRESS;
if (!agentAddress || !isAddress(agentAddress)) fail("AGENT_ADDRESS missing or not a valid address (check .env)");

type MerchantFile = { merchants: { key: string; label: string; address: string }[] };
const file = JSON.parse(readFileSync(new URL("../agent/merchants.json", import.meta.url), "utf8")) as MerchantFile;
const merchants = file.merchants;
if (merchants.length === 0) fail("agent/merchants.json has no merchants");
for (const m of merchants) {
  if (!isAddress(m.address)) fail(`agent/merchants.json: "${m.label}" address is not a valid address yet (${m.address})`);
}
const addrs = merchants.map((m) => m.address.toLowerCase());
if (new Set(addrs).size !== addrs.length) fail("agent/merchants.json: duplicate merchant addresses");

const deployment = addresses[network];
if (!deployment.rienda) fail(`No Rienda deployment recorded for ${network} in packages/sdk/src/addresses.ts`);
const rienda = deployment.rienda;
const usdc = deployment.usdc;

// ── clients (the owner key is never printed) ──
const account = privateKeyToAccount(ownerKey as `0x${string}`);
if (account.address.toLowerCase() === agentAddress.toLowerCase()) fail("AGENT_ADDRESS must differ from the owner address");
if (addrs.includes(agentAddress.toLowerCase()) || addrs.includes(account.address.toLowerCase())) {
  fail("Merchants must not include the agent or owner address");
}

const chain = chainFor(network);
const transport = transportFor(network, process.env);
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ account, chain, transport });

const decimals = await getUsdcDecimals(publicClient, usdc);
const deposit = parseUnits(DEPOSIT, decimals);
const [usdcBalance, monBalance] = await Promise.all([
  publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  publicClient.getBalance({ address: account.address }),
]);

console.log(`Network:   ${chain.name} (${chain.id})`);
console.log(`Rienda:    ${rienda}`);
console.log(`Owner:     ${account.address}`);
console.log(`Agent:     ${agentAddress}`);
console.log(`Owner USDC: ${formatUnits(usdcBalance, decimals)}  MON: ${formatUnits(monBalance, 18)}`);
if (monBalance === 0n) fail("Owner has no MON for gas (https://faucet.monad.xyz)");
if (usdcBalance < deposit) fail(`Owner needs at least ${DEPOSIT} testnet USDC, has ${formatUnits(usdcBalance, decimals)}`);

// ── 1. approve ──
const allowance = await publicClient.readContract({
  address: usdc,
  abi: erc20Abi,
  functionName: "allowance",
  args: [account.address, rienda],
});
let approveHash: `0x${string}` | undefined;
if (allowance >= deposit) {
  console.log(`Allowance already ≥ ${DEPOSIT} USDC: skipping approve`);
} else {
  const { request } = await publicClient.simulateContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [rienda, deposit],
    account,
  });
  approveHash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
  if (receipt.status !== "success") fail(`approve reverted: ${explorerUrl(network, "tx", approveHash)}`);
  console.log(`1. approve   ${approveHash}`);
}

// ── 2. createRein ──
const latest = await publicClient.getBlock();
const expiry = latest.timestamp + BigInt(DEFAULT_LIMITS.expiryDays) * 86_400n;
const params = {
  agent: agentAddress as `0x${string}`,
  perPayCap: parseUnits(DEFAULT_LIMITS.perPayCap, decimals),
  dailyCap: parseUnits(DEFAULT_LIMITS.dailyCap, decimals),
  holdCeiling: parseUnits(DEFAULT_LIMITS.holdCeiling, decimals),
  expiry,
  maxStrikes: DEFAULT_LIMITS.maxStrikes,
};

const { request } = await publicClient.simulateContract({
  address: rienda,
  abi: riendaAbi,
  functionName: "createRein",
  args: [params, merchants.map((m) => m.address as `0x${string}`), merchants.map((m) => m.label), deposit],
  account,
});
const createHash = await walletClient.writeContract(request);
const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
if (createReceipt.status !== "success") fail(`createRein reverted: ${explorerUrl(network, "tx", createHash)}`);

const created = parseEventLogs({ abi: riendaAbi, logs: createReceipt.logs, eventName: "ReinCreated" }).find(
  (l) => l.address.toLowerCase() === rienda.toLowerCase(),
);
if (!created) fail(`createRein succeeded but no ReinCreated event found: ${createHash}`);

console.log(`2. createRein ${createHash}  (gasUsed ${createReceipt.gasUsed})`);
console.log("");
console.log(`✓ reinId: ${created.args.reinId}`);
if (approveHash) console.log(`  approve tx:   ${explorerUrl(network, "tx", approveHash)}`);
console.log(`  createRein tx: ${explorerUrl(network, "tx", createHash)}`);
console.log("");
console.log(`Next: set REIN_ID=${created.args.reinId} in agent/.env and send ~1 MON to the agent (${agentAddress}) for gas.`);
