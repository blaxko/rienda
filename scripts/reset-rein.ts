// Owner-side reset between agent runs. Run from the repo root:  npx tsx scripts/reset-rein.ts
//   1. denies all pending held requests
//   2. unfreezes the rein if it is Frozen (this also resets strikes to 0)
//   3. tops the rein balance up to $20 from the owner wallet if it is below that (approving USDC first if needed)
// Flags:  --dry-run             print what would happen, send nothing
//         --network testnet|mainnet   (default testnet)
//         --confirm-mainnet     required for ANY transaction on mainnet (the owner must say go first)
// Uses OWNER_PRIVATE_KEY and REIN_ID from the root .env. Never prints keys.
import { parseArgs } from "node:util";
import { createAdminContext, exec, riendaCall, topUpRein, usd } from "./lib/rein-admin.js";

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
if (!process.env.REIN_ID || !/^\d+$/.test(process.env.REIN_ID)) throw new Error("REIN_ID missing or invalid in .env");
const reinId = BigInt(process.env.REIN_ID);

const ctx = await createAdminContext({ network, ownerKey: process.env.OWNER_PRIVATE_KEY ?? "", dry });

const rein = await ctx.sdk.getRein(reinId);
if (rein.status === "None") throw new Error(`rein #${reinId} does not exist on ${network}`);
if (rein.owner.toLowerCase() !== ctx.account.address.toLowerCase()) throw new Error("OWNER_PRIVATE_KEY is not the owner of this rein");
console.log(`${dry ? "[dry-run] " : ""}${ctx.chain.name} · rein #${reinId}: ${rein.status}, balance ${usd(ctx, rein.balance)}, strikes ${rein.strikes}/${rein.maxStrikes}, open held ${rein.openHeld}`);

// 1. deny pending held requests
for (const req of await ctx.sdk.getRequests(reinId, { status: "Pending" })) {
  await exec(ctx, `deny(${req.id})`, riendaCall(ctx, "deny", [req.id]));
}

// 2. unfreeze (resets strikes)
if (rein.status === "Frozen") await exec(ctx, `unfreeze(${reinId})`, riendaCall(ctx, "unfreeze", [reinId]));
else if (rein.strikes > 0) console.log("rein is Active with strikes; strikes only reset on unfreeze (freeze then unfreeze if you need 0).");

// 3. top the balance up to $20 from the owner wallet
if ((await topUpRein(ctx, reinId, TOP_UP_TARGET)) === "short-of-usdc") process.exitCode = 1;
console.log("done");
