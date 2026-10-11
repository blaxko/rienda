import { parseEventLogs, type Hash } from "viem";
import { riendaAbi } from "@rienda/sdk";
import { RIENDA, deployment, logSources, publicClient } from "../config";

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

const CONCURRENCY = 8; // windows in flight during history (sliding window, not batches); each source also has its own cap (see Gate)
const RANGE_ERR = /range|response size|too large|exceed/i;

function decode(logs: Awaited<ReturnType<typeof publicClient.getLogs>>): ChainEvent[] {
  return parseEventLogs({ abi: riendaAbi, logs, strict: false }).map((l) => ({
    id: `${l.transactionHash}:${l.logIndex}`,
    name: l.eventName as EventName,
    blockNumber: l.blockNumber,
    logIndex: l.logIndex,
    txHash: l.transactionHash,
    args: (l.args ?? {}) as Record<string, any>,
  }));
}

/**
 * Logs for [from, to] from the fastest source that works. Each source is asked for at most `max` blocks per call
 * (it shrinks if the node says the range is too big) and for at most a few calls at once. A source that fails
 * (including a rate limit, which a browser can't tell from a network error: a 429 carries no CORS headers) is
 * retried after a short back-off, then rested for a while and the next source takes the call. The public RPC is
 * the last resort, and a rested source comes back by itself.
 */
async function getRange(from: bigint, to: bigint, level = 0, tries = 0): Promise<ChainEvent[]> {
  const src = logSources[level]!;
  const last = level === logSources.length - 1;
  const span = to - from + 1n;
  if (!last && src.coolUntil > Date.now()) return getRange(from, to, level + 1);
  if (span > src.max) {
    const mid = from + src.max - 1n;
    const [x, y] = await Promise.all([getRange(from, mid, level), getRange(mid + 1n, to, level)]);
    return [...x, ...y];
  }
  try {
    const events = decode(await src.gate.run(() => src.client.getLogs({ address: RIENDA!, fromBlock: from, toBlock: to })));
    src.fails = 0;
    src.coolUntil = 0;
    dbg(`${src.name} ${from}..${to} (${span}): ${events.length} events`);
    return events;
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (RANGE_ERR.test(msg) && !/rate/i.test(msg) && span > 25n) {
      src.max = span / 2n > 25n ? span / 2n : 25n;
      dbg(`${src.name} range limit, max -> ${src.max}`);
      return getRange(from, to, level);
    }
    if (tries < 2) {
      await new Promise((r) => setTimeout(r, 300 * (tries + 1)));
      return getRange(from, to, level, tries + 1);
    }
    src.fails++;
    src.coolUntil = Date.now() + Math.min(30_000, 1_500 * src.fails);
    dbg(`${src.name} resting ${Math.round((src.coolUntil - Date.now()) / 1000)}s after: ${msg.split("\n")[0]!.slice(0, 80)}`);
    if (!last) return getRange(from, to, level + 1);
    if (src.fails > 12) {
      src.fails = 0;
      throw e; // out of options; the caller retries a few times, then the feed shows an error
    }
    await new Promise((r) => setTimeout(r, 500));
    return getRange(from, to, level);
  }
}

async function getRangeRetry(from: bigint, to: bigint, level = 0, attempts = 4): Promise<ChainEvent[]> {
  let err: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await getRange(from, to, level);
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

/** Keep events of this rein, plus every Approved/Denied (they only carry a requestId; resolved later). */
function relevant(e: ChainEvent, reinId: bigint): boolean {
  if (e.args.reinId !== undefined) return e.args.reinId === reinId;
  return e.name === "Approved" || e.name === "Denied";
}

// ── session cache: a rein's history is fetched once per browser tab ──
const cacheKey = (reinId: bigint) => `rienda:feed:${deployment.rienda}:${reinId}`;
const enc = (_: string, v: unknown) => (typeof v === "bigint" ? { $b: v.toString() } : v);
const dec = (_: string, v: any) => (v && typeof v === "object" && typeof v.$b === "string" ? BigInt(v.$b) : v);
type Cached = { head: bigint; complete: boolean; events: ChainEvent[] };
function loadCache(reinId: bigint): Cached | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(reinId));
    return raw ? (JSON.parse(raw, dec) as Cached) : null;
  } catch {
    return null;
  }
}
function saveCache(reinId: bigint, c: Cached) {
  try {
    sessionStorage.setItem(cacheKey(reinId), JSON.stringify(c, enc));
  } catch {
    /* storage full or blocked: the cache is only a speed-up */
  }
}

export type FeedHandle = { stop: () => void; poke: () => void };

/**
 * History + live feed for one rein, with no indexer.
 * - History walks BACKWARD from the chain head in windows (the size the fastest RPC allows; 100 blocks on the
 *   public RPC), many in flight at once, and every window is shown as soon as it arrives, so the newest events
 *   appear first. It stops as soon as the rein's ReinCreated event is found.
 * - A finished history is cached for the tab session; reopening the rein only fetches what happened since.
 * - Live polling asks for new blocks every 1 s.
 */
export function startReinFeed(
  reinId: bigint,
  h: { onEvents: (events: ChainEvent[]) => void; onHistoryDone: () => void; onError: (e: Error) => void },
): FeedHandle {
  let stopped = false;
  const floor = deployment.deployBlock ?? 0n;
  const all = new Map<string, ChainEvent>();
  let cachedHead = 0n;
  let complete = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveCache(reinId, { head: last, complete, events: [...all.values()] }), 400);
  };

  const push = (evs: ChainEvent[]) => {
    const keep = evs.filter((e) => relevant(e, reinId));
    if (keep.length && !stopped) {
      for (const e of keep) all.set(e.id, e);
      h.onEvents(keep);
      save();
    }
    return evs.some((e) => e.name === "ReinCreated" && e.args.reinId === reinId);
  };

  async function history(head: bigint) {
    // The newest blocks come from the public RPC, the node that reported the head: a faster RPC may lag it by a few blocks.
    const NEWEST = 200n;
    const nearFrom = head - NEWEST + 1n > floor ? head - NEWEST + 1n : floor;
    let found = push(await getRangeRetry(nearFrom, head, logSources.length - 1));
    let cursor = nearFrom - 1n;
    let failure: Error | null = null;
    const inflight = new Set<Promise<void>>();
    const launch = () => {
      while (inflight.size < CONCURRENCY && cursor >= floor && !found && !stopped && !failure) {
        const win = (logSources.find((s) => s.coolUntil <= Date.now()) ?? logSources[logSources.length - 1]!).max;
        const from = cursor - win + 1n > floor ? cursor - win + 1n : floor;
        const to = cursor;
        cursor = from - 1n;
        const p: Promise<void> = getRangeRetry(from, to)
          .then((evs) => {
            if (push(evs)) found = true;
          })
          .catch((e) => {
            failure = e as Error;
          })
          .finally(() => inflight.delete(p));
        inflight.add(p);
      }
    };
    launch();
    while (inflight.size > 0) {
      await Promise.race(inflight);
      launch();
    }
    if (failure) throw failure;
    dbg(`history done (down to block ${cursor + 1n}, ReinCreated found: ${found})`);
    return found || cursor < floor;
  }

  let last = 0n;
  let polling = false;
  async function tick() {
    if (polling || stopped || last === 0n) return;
    polling = true;
    try {
      const head = await publicClient.getBlockNumber();
      if (head > last) {
        const win = logSources[logSources.length - 1]!.max; // live polling stays on the public RPC (see history)
        const ranges: [bigint, bigint][] = [];
        for (let from = last + 1n; from <= head; from += win) ranges.push([from, from + win - 1n < head ? from + win - 1n : head]);
        for (let i = 0; i < ranges.length; i += CONCURRENCY) {
          const res = await Promise.all(ranges.slice(i, i + CONCURRENCY).map(([f, t]) => getRangeRetry(f, t, logSources.length - 1)));
          res.forEach((r) => push(r));
        }
        last = head;
        save();
      }
    } catch (e) {
      dbg("poll failed", e);
    } finally {
      polling = false;
    }
  }

  (async () => {
    try {
      const cached = loadCache(reinId);
      if (cached?.complete) {
        // history already known: show it at once, then catch up from where it ended
        cachedHead = cached.head;
        for (const e of cached.events) all.set(e.id, e);
        h.onEvents(cached.events);
        complete = true;
        last = cachedHead;
        h.onHistoryDone();
        void tick();
        return;
      }
      const head = await publicClient.getBlockNumber();
      last = head; // live polling starts after the head we saw; history covers head and older
      complete = await history(head);
      save();
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
      clearTimeout(saveTimer);
      if (last > 0n) saveCache(reinId, { head: last, complete, events: [...all.values()] });
    },
    poke: () => void tick(),
  };
}

// ───────────────────────────── block timestamps ─────────────────────────────

const blockTimes = new Map<bigint, number>();

export async function loadBlockTimes(blocks: bigint[]): Promise<Map<bigint, number>> {
  const missing = [...new Set(blocks)].filter((b) => !blockTimes.has(b));
  for (let i = 0; i < missing.length; i += 12) {
    await Promise.all(
      missing.slice(i, i + 12).map(async (b) => {
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
