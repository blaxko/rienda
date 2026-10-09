import {
  BaseError,
  ContractFunctionRevertedError,
  parseEventLogs,
  type Hash,
  type PublicClient,
  type WalletClient,
  type WatchContractEventOnLogsParameter,
} from "viem";
import { riendaAbi } from "./abi.js";
import { MAX_MEMO_BYTES, PAY_GAS_LIMIT } from "./constants.js";

export * from "./abi.js";
export * from "./addresses.js";
export * from "./chains.js";
export * from "./constants.js";

// ───────────────────────────── Types ─────────────────────────────

export const STATUS_NAMES = ["None", "Active", "Frozen", "Closed"] as const;
export const REASON_NAMES = ["None", "NOT_ALLOWED", "ABOVE_CEILING", "TOO_MANY_HELD", "NO_FUNDS"] as const;
export const REQ_STATUS_NAMES = ["None", "Pending", "Approved", "Denied"] as const;

export type StatusName = (typeof STATUS_NAMES)[number];
export type Reason = Exclude<(typeof REASON_NAMES)[number], "None">;
export type RequestStatusName = (typeof REQ_STATUS_NAMES)[number];
export type OutcomeName = "Paid" | "Held" | "Blocked";

export type Rein = {
  owner: `0x${string}`;
  agent: `0x${string}`;
  balance: bigint;
  perPayCap: bigint;
  dailyCap: bigint;
  holdCeiling: bigint;
  spentToday: bigint;
  /** UTC calendar day (block.timestamp / 1 days) that `spentToday` belongs to. */
  day: bigint;
  expiry: bigint;
  strikes: number;
  maxStrikes: number;
  openHeld: number;
  status: StatusName;
};

export type HeldRequest = {
  id: bigint;
  reinId: bigint;
  to: `0x${string}`;
  amount: bigint;
  createdAt: bigint;
  status: RequestStatusName;
};

export type PayParams = {
  reinId: bigint;
  to: `0x${string}`;
  /** USDC base units (6 decimals): use `parseUnits("2", 6)`. */
  amount: bigint;
  memo: string;
};

export type PayResult = {
  outcome: OutcomeName;
  /** Set when outcome is "Blocked". */
  reason?: Reason;
  /** Set when outcome is "Held". */
  requestId?: bigint;
  /** True if this transaction also froze the rein (strike limit reached). */
  frozen?: boolean;
  /** Strike count after a Blocked outcome. */
  strikes?: number;
  txHash: Hash;
  blockNumber: bigint;
  /** Gas actually used; use it to re-measure PAY_GAS_LIMIT on Monad. */
  gasUsed: bigint;
};

export type RiendaEvent = WatchContractEventOnLogsParameter<typeof riendaAbi>[number];

/** Thrown when `pay` reverts (the FR-7 cases). Simulation catches it before any gas is spent. */
export class RiendaRevertError extends Error {
  constructor(
    /** Solidity custom error name, e.g. "ReinFrozen", "NotAgent", "ReinExpired". */
    public readonly errorName: string,
    options?: { cause?: unknown },
  ) {
    super(`Rienda: pay reverted with ${errorName}`, options);
    this.name = "RiendaRevertError";
  }
}

export type CreateRiendaConfig = {
  address: `0x${string}`;
  publicClient: PublicClient;
  /** Only needed for `pay`. Must have an account (the agent key). */
  walletClient?: WalletClient;
  /** Gas limit for `pay`. Defaults to PAY_GAS_LIMIT. */
  gasLimit?: bigint;
};

// ───────────────────────────── Helpers ─────────────────────────────

function revertName(err: unknown): string | undefined {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.data?.errorName ?? reverted.reason ?? undefined;
    }
  }
  return undefined;
}

function toRein(r: Omit<Rein, "status"> & { status: number }): Rein {
  return { ...r, status: STATUS_NAMES[r.status] ?? "None" };
}

const REQUEST_BATCH = 100n;

// ───────────────────────────── SDK ─────────────────────────────

export function createRienda(config: CreateRiendaConfig) {
  const { address, publicClient, walletClient } = config;
  const gas = config.gasLimit ?? PAY_GAS_LIMIT;

  /**
   * Pay a merchant through a rein. Simulates first (so FR-7 reverts cost nothing), sends with a fixed
   * gas limit, waits for the receipt and decodes the outcome from events.
   * Policy violations do NOT throw: they return `{ outcome: "Blocked", reason }`.
   */
  async function pay({ reinId, to, amount, memo }: PayParams): Promise<PayResult> {
    if (!walletClient?.account) throw new Error("Rienda: pay needs a walletClient with an account (the agent)");
    if (amount <= 0n) throw new Error("Rienda: amount must be > 0");
    if (amount > 2n ** 128n - 1n) throw new Error("Rienda: amount exceeds uint128");
    if (new TextEncoder().encode(memo).length > MAX_MEMO_BYTES) {
      throw new Error(`Rienda: memo longer than ${MAX_MEMO_BYTES} bytes`);
    }

    let request;
    try {
      ({ request } = await publicClient.simulateContract({
        address,
        abi: riendaAbi,
        functionName: "pay",
        args: [reinId, to, amount, memo],
        account: walletClient.account,
        gas,
      }));
    } catch (err) {
      const name = revertName(err);
      if (name) throw new RiendaRevertError(name, { cause: err });
      throw err;
    }

    const txHash = await walletClient.writeContract({ ...request, gas });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`Rienda: pay transaction reverted onchain (${txHash}, gasUsed ${receipt.gasUsed}/${gas})`);
    }

    const logs = parseEventLogs({ abi: riendaAbi, logs: receipt.logs }).filter(
      (l) => l.address.toLowerCase() === address.toLowerCase(),
    );
    const base = { txHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
    const frozen = logs.some((l) => l.eventName === "Frozen" && l.args.auto_) || undefined;

    for (const log of logs) {
      if (log.eventName === "Paid") return { outcome: "Paid", ...base };
      if (log.eventName === "Held") return { outcome: "Held", requestId: log.args.requestId, ...base };
      if (log.eventName === "Blocked") {
        return {
          outcome: "Blocked",
          reason: (REASON_NAMES[log.args.reason] ?? "None") as Reason,
          strikes: log.args.strikes,
          frozen,
          ...base,
        };
      }
    }
    throw new Error(`Rienda: no Paid/Held/Blocked event in ${txHash}`);
  }

  async function getRein(reinId: bigint): Promise<Rein> {
    const r = await publicClient.readContract({ address, abi: riendaAbi, functionName: "getRein", args: [reinId] });
    return toRein(r);
  }

  /**
   * Held requests for a rein (all statuses unless `status` is given). Reads requests by id with
   * multicall rather than getLogs, so it isn't affected by RPC block-range limits.
   */
  async function getRequests(reinId: bigint, opts: { status?: RequestStatusName } = {}): Promise<HeldRequest[]> {
    const total = await publicClient.readContract({ address, abi: riendaAbi, functionName: "nextRequestId" });
    const out: HeldRequest[] = [];
    for (let start = 0n; start < total; start += REQUEST_BATCH) {
      const end = start + REQUEST_BATCH < total ? start + REQUEST_BATCH : total;
      const ids: bigint[] = [];
      for (let i = start; i < end; i++) ids.push(i);
      const rows = await publicClient.multicall({
        allowFailure: false,
        contracts: ids.map((id) => ({
          address,
          abi: riendaAbi,
          functionName: "requests" as const,
          args: [id] as const,
        })),
      });
      rows.forEach((row, i) => {
        const [rid, to, amount, createdAt, status] = row;
        if (rid !== reinId) return;
        const item: HeldRequest = {
          id: ids[i]!,
          reinId: rid,
          to,
          amount,
          createdAt: BigInt(createdAt),
          status: REQ_STATUS_NAMES[status] ?? "None",
        };
        if (!opts.status || item.status === opts.status) out.push(item);
      });
    }
    return out;
  }

  /**
   * All reins (optionally only those owned by `owner`), read by id with multicall.
   * Cost scales with the total number of reins ever created on this contract.
   */
  async function getReins(opts: { owner?: `0x${string}` } = {}): Promise<{ id: bigint; rein: Rein }[]> {
    const total = await publicClient.readContract({ address, abi: riendaAbi, functionName: "nextReinId" });
    const out: { id: bigint; rein: Rein }[] = [];
    for (let start = 0n; start < total; start += REQUEST_BATCH) {
      const end = start + REQUEST_BATCH < total ? start + REQUEST_BATCH : total;
      const ids: bigint[] = [];
      for (let i = start; i < end; i++) ids.push(i);
      const rows = await publicClient.multicall({
        allowFailure: false,
        contracts: ids.map((id) => ({ address, abi: riendaAbi, functionName: "getRein" as const, args: [id] as const })),
      });
      rows.forEach((row, i) => {
        const rein = toRein(row);
        if (!opts.owner || rein.owner.toLowerCase() === opts.owner.toLowerCase()) out.push({ id: ids[i]!, rein });
      });
    }
    return out;
  }

  /**
   * Subscribe to every event for a rein, polling every 1 s. Approved/Denied only carry a requestId,
   * so their rein is looked up. Returns an unsubscribe function.
   */
  function watch(reinId: bigint, onEvent: (event: RiendaEvent) => void, onError?: (err: Error) => void): () => void {
    const requestRein = new Map<bigint, bigint>();

    const belongs = async (log: RiendaEvent): Promise<boolean> => {
      const args = log.args as Record<string, unknown>;
      if (typeof args.reinId === "bigint") return args.reinId === reinId;
      if (typeof args.requestId === "bigint") {
        let rid = requestRein.get(args.requestId);
        if (rid === undefined) {
          const row = await publicClient.readContract({
            address,
            abi: riendaAbi,
            functionName: "requests",
            args: [args.requestId],
          });
          rid = row[0];
          requestRein.set(args.requestId, rid);
        }
        return rid === reinId;
      }
      return false;
    };

    return publicClient.watchContractEvent({
      address,
      abi: riendaAbi,
      poll: true,
      pollingInterval: 1_000,
      onLogs: async (logs) => {
        for (const log of logs) {
          try {
            if (await belongs(log)) onEvent(log);
          } catch (err) {
            onError?.(err as Error);
          }
        }
      },
      onError,
    });
  }

  return { address, pay, getRein, getReins, getRequests, watch };
}

export type Rienda = ReturnType<typeof createRienda>;
