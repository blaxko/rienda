import type { PublicClient } from "viem";
import { erc20Abi } from "viem";

/**
 * Fixed gas limit for `pay`. Monad charges the declared gas limit, not gas used (receipts show
 * gasUsed == limit), so never use estimateGas() * N. Measured with eth_estimateGas on Monad testnet
 * at the block before each tx (Oct 9 run): Paid 141,272 / Held 126,171 / Blocked 69,528 /
 * Blocked+Frozen 71,216. Highest + 30% = 183,654; raised to 250,000 for the unmeasured day-rollover
 * and first-Held cases (out-of-gas would lose the Blocked event). Re-check with `cast estimate` on a new UTC day.
 */
export const PAY_GAS_LIMIT = 250_000n;

/** Expected USDC decimals. Always confirm at runtime with `getUsdcDecimals`. */
export const EXPECTED_USDC_DECIMALS = 6;

/** Defaults for the create-rein form and test scripts, in whole USDC (dollars). */
export const DEFAULT_LIMITS = {
  perPayCap: "5",
  dailyCap: "20",
  holdCeiling: "50",
  maxStrikes: 3,
  expiryDays: 7,
} as const;

/** Contract-level constants mirrored here for UI validation. */
export const MAX_MEMO_BYTES = 140;
export const MAX_OPEN_HELD = 5;
export const MAX_STRIKES_LIMIT = 10;

/** Read USDC `decimals()` from chain (expect 6). */
export async function getUsdcDecimals(publicClient: PublicClient, usdc: `0x${string}`): Promise<number> {
  return publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "decimals" });
}
