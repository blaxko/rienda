// Owner-side helpers shared by scripts/reset-rein.ts and scripts/timing.ts (testnet tooling).
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  addresses,
  chainFor,
  createRienda,
  explorerUrl,
  getUsdcDecimals,
  riendaAbi,
  transportFor,
  type Network,
} from "@rienda/sdk";

export type AdminCtx = Awaited<ReturnType<typeof createAdminContext>>;

/** Owner wallet + read client for one network. `dry` makes `exec` print instead of send. */
export async function createAdminContext(opts: { network: Network; ownerKey: string; dry: boolean }) {
  const { network, ownerKey, dry } = opts;
  if (!/^0x[0-9a-fA-F]{64}$/.test(ownerKey)) throw new Error("OWNER_PRIVATE_KEY missing or invalid in .env");
  const { rienda, usdc } = addresses[network];
  if (!rienda) throw new Error(`no ${network} deployment recorded`);
  const account = privateKeyToAccount(ownerKey as `0x${string}`);
  const chain = chainFor(network);
  const transport = transportFor(network, process.env);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });
  const sdk = createRienda({ address: rienda, publicClient });
  const decimals = await getUsdcDecimals(publicClient, usdc);
  return { network, dry, rienda, usdc, account, chain, publicClient, walletClient, sdk, decimals };
}

export const usd = (ctx: AdminCtx, units: bigint) => `$${formatUnits(units, ctx.decimals)}`;

export type Call = { address: `0x${string}`; abi: unknown; functionName: string; args: readonly unknown[] };

export const riendaCall = (ctx: AdminCtx, functionName: string, args: readonly unknown[]): Call => ({
  address: ctx.rienda,
  abi: riendaAbi,
  functionName,
  args,
});

/** Simulate, send and wait for one owner transaction (or print it in dry-run). */
export async function exec(ctx: AdminCtx, label: string, call: Call) {
  if (ctx.dry) {
    console.log(`[dry-run] would send ${label}`);
    return;
  }
  const { request } = await ctx.publicClient.simulateContract({ ...call, account: ctx.account } as any);
  const hash = await ctx.walletClient.writeContract(request as any);
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${explorerUrl(ctx.network, "tx", hash)}`);
  console.log(`${label} ${explorerUrl(ctx.network, "tx", hash)}`);
}

export type TopUpResult = "closed" | "not-needed" | "topped-up" | "short-of-usdc";

/**
 * Brings the rein balance up to `targetUsd` dollars from the owner wallet (approving USDC first if needed).
 * If the owner can't cover it, prints a clear message and returns "short-of-usdc".
 */
export async function topUpRein(ctx: AdminCtx, reinId: bigint, targetUsd: string): Promise<TopUpResult> {
  const rein = await ctx.sdk.getRein(reinId);
  const target = parseUnits(targetUsd, ctx.decimals);
  if (rein.status === "Closed") {
    console.log("rein is Closed: it can't take deposits. Create a new rein with scripts/create-test-rein.ts.");
    return "closed";
  }
  if (rein.balance >= target) {
    console.log(`balance ${usd(ctx, rein.balance)} is already at least ${usd(ctx, target)}: no top-up needed`);
    return "not-needed";
  }
  const need = target - rein.balance;
  const ownerUsdc = await ctx.publicClient.readContract({
    address: ctx.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [ctx.account.address],
  });
  console.log(
    `rein balance ${usd(ctx, rein.balance)} < ${usd(ctx, target)}; needs ${usd(ctx, need)} more. Owner USDC balance: ${usd(ctx, ownerUsdc)} (${ctx.account.address})`,
  );
  if (ownerUsdc < need) {
    console.error(
      `\n✗ Not enough USDC to top up: the owner has ${usd(ctx, ownerUsdc)} and needs ${usd(ctx, need)}.\n` +
        (ctx.network === "testnet"
          ? `  Get testnet USDC at https://faucet.circle.com (select "Monad Testnet") for the owner address:\n  ${ctx.account.address}\n  then run this script again.`
          : `  Send USDC to the owner address ${ctx.account.address}, then run this script again.`),
    );
    return "short-of-usdc";
  }
  const allowance = await ctx.publicClient.readContract({
    address: ctx.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [ctx.account.address, ctx.rienda],
  });
  if (allowance < need) {
    await exec(ctx, `approve ${usd(ctx, need)} USDC`, { address: ctx.usdc, abi: erc20Abi, functionName: "approve", args: [ctx.rienda, need] });
  }
  await exec(ctx, `deposit(${reinId}, ${usd(ctx, need)})`, riendaCall(ctx, "deposit", [reinId, need]));
  if (!ctx.dry) console.log(`rein balance is now ${usd(ctx, (await ctx.sdk.getRein(reinId)).balance)}`);
  return "topped-up";
}
