import { useEffect, useMemo, useRef, useState } from "react";
import { buildView, loadBlockTimes, startReinFeed, type ChainEvent } from "./events";

/** Live feed for one rein: history (backward from head) + 1 s polling. */
export function useReinFeed(reinId: bigint) {
  const [events, setEvents] = useState<Map<string, ChainEvent>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [times, setTimes] = useState<Map<bigint, number>>(() => new Map());
  const pokeRef = useRef<() => void>(() => {});

  useEffect(() => {
    setEvents(new Map());
    setLoading(true);
    setError(null);
    const feed = startReinFeed(reinId, {
      onEvents: (evs) =>
        setEvents((prev) => {
          const next = new Map(prev);
          for (const e of evs) next.set(e.id, e);
          return next;
        }),
      onHistoryDone: () => setLoading(false),
      onError: (e) => {
        setError(e.message);
        setLoading(false);
      },
    });
    pokeRef.current = feed.poke;
    return feed.stop;
  }, [reinId]);

  const view = useMemo(() => buildView(events.values(), reinId), [events, reinId]);

  // block timestamps for the rows we show
  const blocksKey = view.feed.map((e) => e.blockNumber).join(",");
  useEffect(() => {
    let cancelled = false;
    loadBlockTimes(view.feed.map((e) => e.blockNumber)).then((m) => {
      if (!cancelled) setTimes(new Map(m));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocksKey]);

  return { view, times, loading, error, refresh: () => pokeRef.current() };
}
