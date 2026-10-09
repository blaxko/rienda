// Owner-side reset between agent runs: denies all pending held requests, then unfreezes the rein
// (which also resets strikes to 0). Run from repo root:  npx tsx scripts/reset-rein.ts
// Testnet only. Uses OWNER_PRIVATE_KEY and REIN_ID from the root .env. Never prints keys.
import { createPublicClient, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { addresses, chainFor, createRienda, explorerUrl, riendaAbi, transportFor } from "@rienda/sdk";

try {
  process.loadEnvFile(".env");
} catch {
  // rely on real env
}

const network = "testnet" as const;
const key = process.env.OWNER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("OWNER_PRIVATE_KEY missing or invalid in .env");
if (!process.env.REIN_ID || !/^\d+$/.test(process.env.REIN_ID)) throw new Error("REIN_ID missing or invalid in .env");
const reinId = BigInt(process.env.REIN_ID);
const rienda = addresses[network].rienda;
if (!rienda) throw new Error("no testnet deployment recorded");

const account = privateKeyToAccount(key as `0x${string}`);
const chain = chainFor(network);
const transport = transportFor(network, process.env);
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ account, chain, transport });
const sdk = createRienda({ address: rienda, publicClient });

const rein = await sdk.getRein(reinId);
if (rein.owner.toLowerCase() !== account.address.toLowerCase()) throw new Error("OWNER_PRIVATE_KEY is not the owner of this rein");
console.log(`rein #${reinId}: ${rein.status}, strikes ${rein.strikes}/${rein.maxStrikes}, open held ${rein.openHeld}`);

async function send(functionName: "deny" | "unfreeze", args: readonly [bigint]) {
  const { request } = await publicClient.simulateContract({ address: rienda!, abi: riendaAbi, functionName, args, account });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${explorerUrl(network, "tx", hash)}`);
  console.log(`${functionName}(${args[0]}) ${explorerUrl(network, "tx", hash)}`);
}

for (const req of await sdk.getRequests(reinId, { status: "Pending" })) await send("deny", [req.id]);
if (rein.status === "Frozen") await send("unfreeze", [reinId]);
else if (rein.strikes > 0) console.log("rein is Active with strikes; strikes only reset on unfreeze (freeze then unfreeze if you need 0).");
console.log("done");
