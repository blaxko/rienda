import { parseEventLogs, type Hash } from "viem";
import { riendaAbi } from "@rienda/sdk";
import { RIENDA, deployment, publicClient } from "../config";

export type EventName =
  | "ReinCreated"
  | "MerchantSet"
  | "LimitsSet"
  | "Deposited"
  | "Withdrawn"
  | "Paid"
  | "Held"
  | "Blocked"
  | "Frozen"
  | "Unfrozen"
  | "Approved"
  | "Denied"
  | "Closed";

export type ChainEvent = {
  id: string;
  name: EventName;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hash;
  args: Record<string, any>;
};

const dbg = (...a: unknown[]) => console.debug("[rienda/events]", ...a);

async function fetchRange(from: bigint, to: bigint): Promise<ChainEvent[]> {
  const logs = await publicClient.getLogs({ address: RIENDA!, fromBlock: from, toBlock: to });
  const parsed = parseEventLogs({ abi: riendaAbi, logs, strict: false });
  const events = parsed.map((l) => ({
    id: `${l.transactionHash}:${l.logIndex}`,
    name: l.eventName as EventName,
    blockNumber: l.blockNumber,
    logIndex: l.logIndex,
    txHash: l.transactionHash,
    args: (l.args ?? {}) as Record<string, any>,
  }));
  dbg(`getLogs ${from}..${to} (${to - from + 1n} blocks): ${logs.length} logs, ${events.length} decoded`);
  return events;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 300 * i));
    }
  }
  throw last;
}

/** Keep events of this rein, plus every Approved/Denied (they only carry a requestId; resolved later). */
function relevant(e: ChainEvent, reinId: bigint): boolean {
  if (e.args.reinId !== undefined) return e.args.reinId === reinId;
  return e.name === "Approved" || e.name === "Denied";
}

/** Chunk size learned from RPC errors; kept for the session so later page loads skip the discovery. */
let chunkHint = 5000n;

export type FeedHandle = { stop: () => void; poke: () => void };

/**
 * History + live feed for one rein, with no indexer.
 * - History walks BACKWARD from the chain head in chunks (start 5,000 blocks, halve on error: the public
 *   testnet RPC allows only 100), several chunks in parallel, and stops as soon as the rein's ReinCreated
 *   event is found, so the cost follows the rein's age rather than the contract's.
 * - Live polling asks for new blocks every 1 s.
 */
export function startReinFeed(
  reinId: bigint,
  h: { onEvents: (events: ChainEvent[]) => void; onHistoryDone: () => void; onError: (e: Error) => void },
): FeedHandle {
  let stopped = false;
  let chunk = chunkHint;
  const floor = deployment.deployBlock ?? 0n;
  const push = (evs: ChainEvent[]) => {
    const keep = evs.filter((e) => relevant(e, reinId));
    if (keep.length && !stopped) h.onEvents(keep);
    return evs.some((e) => e.name === "ReinCreated" && e.args.reinId === reinId);
  };

  async function history(head: bigint) {
    let cursor = head;
    let discovered = false;
    let foundCreated = false;
    while (cursor >= floor && !foundCreated && !stopped) {
      if (!discovered) {
        const from = cursor - chunk + 1n > floor ? cursor - chunk + 1n : floor;
        try {
          foundCreated = push(await fetchRange(from, cursor));
          discovered = true;
          cursor = from - 1n;
        } catch (e) {
          if (chunk <= 50n) throw e;
          chunk = chunk / 2n;
          chunkHint = chunk;
          dbg(`getLogs failed, halving chunk to ${chunk}`);
        }
      } else {
        const ranges: [bigint, bigint][] = [];
        let c = cursor;
        for (let k = 0; k < 6 && c >= floor; k++) {
          const from = c - chunk + 1n > floor ? c - chunk + 1n : floor;
          ranges.push([from, c]);
          c = from - 1n;
        }
        const results = await Promise.all(ranges.map(([f, t]) => withRetry(() => fetchRange(f, t))));
        for (const r of results) if (push(r)) foundCreated = true;
        cursor = c;
      }
    }
    dbg(`history done (stopped at block ${cursor + 1n}, ReinCreated found: ${foundCreated})`);
  }

  let last = 0n;
  let polling = false;
  async function tick() {
    if (polling || stopped || last === 0n) return;
    polling = true;
    try {
      const head = await publicClient.getBlockNumber();
      if (head > last) {
        let from = last + 1n;
        while (from <= head && !stopped) {
          const to = from + chunk - 1n < head ? from + chunk - 1n : head;
          push(await fetchRange(from, to));
          from = to + 1n;
          last = to;
        }
      }
    } catch (e) {
      if (chunk > 50n) chunkHint = chunk = chunk / 2n; // maybe a range limit after a long sleep
      dbg("poll failed", e);
    } finally {
      polling = false;
    }
  }

  (async () => {
    try {
      const head = await publicClient.getBlockNumber();
      last = head; // live polling starts after the head we saw; history covers head and older
      await history(head);
      if (!stopped) h.onHistoryDone();
    } catch (e) {
      if (!stopped) h.onError(e as Error);
    }
  })();
  const timer = setInterval(tick, 1000);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    poke: () => void tick(),
  };
}

// ───────────────────────────── block timestamps ─────────────────────────────

const blockTimes = new Map<bigint, number>();

export async function loadBlockTimes(blocks: bigint[]): Promise<Map<bigint, number>> {
  const missing = [...new Set(blocks)].filter((b) => !blockTimes.has(b));
  for (let i = 0; i < missing.length; i += 5) {
    await Promise.all(
      missing.slice(i, i + 5).map(async (b) => {
        try {
          const blk = await publicClient.getBlock({ blockNumber: b });
          blockTimes.set(b, Number(blk.timestamp));
        } catch {
          /* time stays unknown; shown as … */
        }
      }),
    );
  }
  return blockTimes;
}

// ───────────────────────────── derived view ─────────────────────────────

export type ReinView = {
  /** newest first */
  feed: ChainEvent[];
  merchants: { address: `0x${string}`; label: string; allowed: boolean }[];
  held: Map<bigint, ChainEvent>;
  label: (addr: string) => string | undefined;
};

const FEED_NAMES: EventName[] = ["Paid", "Held", "Blocked", "Frozen", "Unfrozen", "Approved", "Denied"];

export function buildView(events: Iterable<ChainEvent>, reinId: bigint): ReinView {
  const all = [...events].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
  const held = new Map<bigint, ChainEvent>();
  const labels = new Map<string, { address: `0x${string}`; label: string; allowed: boolean }>();
  for (const e of all) {
    if (e.name === "Held" && e.args.reinId === reinId) held.set(e.args.requestId, e);
    if (e.name === "MerchantSet" && e.args.reinId === reinId) {
      labels.set(String(e.args.merchant).toLowerCase(), { address: e.args.merchant, label: e.args.label, allowed: e.args.allowed });
    }
  }
  const feed = all
    .filter((e) => FEED_NAMES.includes(e.name))
    .filter((e) => (e.name === "Approved" || e.name === "Denied" ? held.has(e.args.requestId) : e.args.reinId === reinId))
    .reverse();
  return {
    feed,
    merchants: [...labels.values()],
    held,
    label: (addr) => labels.get(addr.toLowerCase())?.label,
  };
}
