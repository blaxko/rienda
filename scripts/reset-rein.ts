// Owner-side reset between agent runs. Run from the repo root:  npx tsx scripts/reset-rein.ts
//   1. denies all pending held requests
//   2. unfreezes the rein if it is Frozen (this also resets strikes to 0)
//   3. tops the rein balance up to $20 from the owner wallet if it is below that (approving USDC first if needed)
// Flags:  --dry-run             print what would happen, send nothing
//         --network testnet|mainnet   (default testnet)
//         --confirm-mainnet     required for ANY transaction on mainnet (the owner must say go first)
// Uses OWNER_PRIVATE_KEY and REIN_ID from the root .env. Never prints keys.
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { addresses, chainFor, createRienda, explorerUrl, getUsdcDecimals, riendaAbi, transportFor } from "@rienda/sdk";

try {
  process.loadEnvFile(".env");
} catch {
  // rely on real env
}

const TOP_UP_TARGET = "20"; // USDC (dollars): one injection run spends $6

const { values } = parseArgs({
  options: {
    network: { type: "string", default: "testnet" },
    "confirm-mainnet": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
  strict: true,
});
const network = values.network;
if (network !== "testnet" && network !== "mainnet") throw new Error("--network must be testnet or mainnet");
const dry = values["dry-run"] === true;
if (network === "mainnet" && !values["confirm-mainnet"] && !dry) {
  console.error("✗ Refusing: this would send mainnet transactions (deny / unfreeze / USDC top-up). Re-run with --confirm-mainnet only after the owner has said go, or use --dry-run.");
  process.exit(1);
}

const key = process.env.OWNER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("OWNER_PRIVATE_KEY missing or invalid in .env");
if (!process.env.REIN_ID || !/^\d+$/.test(process.env.REIN_ID)) throw new Error("REIN_ID missing or invalid in .env");
const reinId = BigInt(process.env.REIN_ID);
const { rienda, usdc } = addresses[network];
if (!rienda) throw new Error(`no ${network} deployment recorded`);

const account = privateKeyToAccount(key as `0x${string}`);
const chain = chainFor(network);
const transport = transportFor(network, process.env);
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ account, chain, transport });
const sdk = createRienda({ address: rienda, publicClient });
const decimals = await getUsdcDecimals(publicClient, usdc);
const usd = (units: bigint) => `$${formatUnits(units, decimals)}`;

const rein = await sdk.getRein(reinId);
if (rein.status === "None") throw new Error(`rein #${reinId} does not exist on ${network}`);
if (rein.owner.toLowerCase() !== account.address.toLowerCase()) throw new Error("OWNER_PRIVATE_KEY is not the owner of this rein");
console.log(`${dry ? "[dry-run] " : ""}${chain.name} · rein #${reinId}: ${rein.status}, balance ${usd(rein.balance)}, strikes ${rein.strikes}/${rein.maxStrikes}, open held ${rein.openHeld}`);

type Call = { address: `0x${string}`; abi: unknown; functionName: string; args: readonly unknown[] };
async function exec(label: string, call: Call) {
  if (dry) {
    console.log(`[dry-run] would send ${label}`);
    return;
  }
  const { request } = await publicClient.simulateContract({ ...call, account } as any);
  const hash = await walletClient.writeContract(request as any);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${explorerUrl(network as "testnet" | "mainnet", "tx", hash)}`);
  console.log(`${label} ${explorerUrl(network as "testnet" | "mainnet", "tx", hash)}`);
}
const riendaCall = (functionName: string, args: readonly unknown[]): Call => ({ address: rienda, abi: riendaAbi, functionName, args });

// 1. deny pending held requests
for (const req of await sdk.getRequests(reinId, { status: "Pending" })) await exec(`deny(${req.id})`, riendaCall("deny", [req.id]));

// 2. unfreeze (resets strikes)
if (rein.status === "Frozen") await exec(`unfreeze(${reinId})`, riendaCall("unfreeze", [reinId]));
else if (rein.strikes > 0) console.log("rein is Active with strikes; strikes only reset on unfreeze (freeze then unfreeze if you need 0).");

// 3. top the balance up to $20 from the owner wallet
const target = parseUnits(TOP_UP_TARGET, decimals);
const current = (await sdk.getRein(reinId)).balance;
if (rein.status === "Closed") {
  console.log("rein is Closed: it can't take deposits. Create a new rein with scripts/create-test-rein.ts.");
} else if (current >= target) {
  console.log(`balance ${usd(current)} is already at least ${usd(target)}: no top-up needed`);
} else {
  const need = target - current;
  const ownerUsdc = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  console.log(`rein balance ${usd(current)} < ${usd(target)}; needs ${usd(need)} more. Owner USDC balance: ${usd(ownerUsdc)} (${account.address})`);
  if (ownerUsdc < need) {
    console.error(
      `\n✗ Not enough USDC to top up: the owner has ${usd(ownerUsdc)} and needs ${usd(need)}.\n` +
        (network === "testnet"
          ? `  Get testnet USDC at https://faucet.circle.com (select "Monad Testnet") for the owner address:\n  ${account.address}\n  then run this script again.`
          : `  Send USDC to the owner address ${account.address}, then run this script again.`),
    );
    process.exitCode = 1;
  } else {
    const allowance = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "allowance", args: [account.address, rienda] });
    if (allowance < need) {
      await exec(`approve ${usd(need)} USDC`, { address: usdc, abi: erc20Abi, functionName: "approve", args: [rienda, need] });
    }
    await exec(`deposit(${reinId}, ${usd(need)})`, riendaCall("deposit", [reinId, need]));
    if (!dry) console.log(`rein balance is now ${usd((await sdk.getRein(reinId)).balance)}`);
  }
}
console.log("done");
