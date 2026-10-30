import type { ISubscription, SubscriptionClient } from "@nktkas/hyperliquid";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Network } from "@/lib/account";
import { subscriptionClient } from "@/lib/hyperliquid";
import { acquireFeed } from "@/lib/live";

type Subscribe<E> = (client: SubscriptionClient, listener: (event: E) => void, options: { onError: () => void }) => Promise<ISubscription>;

// Keeps the query at `queryKey` current from a websocket feed: each event is
// mapped onto the cached value. Returns whether the feed is confirmed, so the
// query can poll slowly while it is and normally while it is not.
// `feedId` distinguishes feeds that write the same query (one market's price
// context into the shared market list).
export function useLiveFeed<E, T>(
  network: Network,
  queryKey: QueryKey,
  subscribe: Subscribe<E> | null,
  apply: (event: E, prev: T | undefined) => T | undefined,
  feedId = "",
): boolean {
  const queryClient = useQueryClient();
  const [live, setLive] = useState(false);
  const fns = useRef({ subscribe, apply });
  fns.current = { subscribe, apply };
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;
  const key = JSON.stringify([queryKey, feedId]);
  const enabled = subscribe !== null;

  useEffect(() => {
    if (!enabled) return;
    const release = acquireFeed(
      key,
      (push, onFail) => fns.current.subscribe!(subscriptionClient(network), push as (e: E) => void, { onError: onFail }),
      (event) => queryClient.setQueryData<T>(queryKeyRef.current, (prev) => fns.current.apply(event as E, prev)),
      setLive,
    );
    return () => {
      release();
      setLive(false);
    };
  }, [key, enabled, network, queryClient]);

  return enabled && live;
}
