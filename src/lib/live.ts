import type { ISubscription } from "@nktkas/hyperliquid";

// Hyperliquid WebSocket feeds shared within one page (popup or side panel).
// REST polling shares a 1200/min weight budget per IP with order submission
// (Hyperliquid rate-limit docs); websocket subscriptions have separate limits,
// so live data comes from feeds and polling drops to a slow fallback while a
// feed is confirmed.
//
//   component A ─┐                       ┌─ push(event) ─▶ query cache
//   component B ─┼─ acquireFeed(key) ─── one subscription per key
//                └─ live(bool) watchers ◀─ confirmed / failed / released

// Subscribes; `push` receives events, `onFail` an already confirmed
// subscription that later failed (SDK onError).
export type FeedStart = (push: (data: unknown) => void, onFail: () => void) => Promise<ISubscription>;

interface Feed {
  refs: number;
  live: boolean;
  watchers: Set<(live: boolean) => void>;
  stop: () => void;
}

const feeds = new Map<string, Feed>();

// Returns the release function. The first acquirer's `start` and `push` serve
// every acquirer of the same key; they all write the same query.
export function acquireFeed(key: string, start: FeedStart, push: (data: unknown) => void, watch: (live: boolean) => void): () => void {
  let feed = feeds.get(key);
  if (!feed) {
    const f: Feed = { refs: 0, live: false, watchers: new Set(), stop: () => {} };
    const setLive = (live: boolean) => {
      if (f.live === live) return;
      f.live = live;
      for (const w of f.watchers) w(live);
    };
    let released = false;
    let sub: ISubscription | null = null;
    start(push, () => {
      setLive(false);
      // A failed feed is dropped so the next acquire starts a fresh one.
      if (feeds.get(key) === f) feeds.delete(key);
    }).then(
      (s) => {
        if (released) void s.unsubscribe().catch(() => {});
        else {
          sub = s;
          setLive(true);
        }
      },
      () => {
        // Never confirmed, so never live; drop it so the next acquire retries.
        if (feeds.get(key) === f) feeds.delete(key);
      },
    );
    f.stop = () => {
      released = true;
      void sub?.unsubscribe().catch(() => {});
    };
    feeds.set(key, f);
    feed = f;
  }
  const f = feed;
  f.refs++;
  f.watchers.add(watch);
  watch(f.live);
  return () => {
    f.watchers.delete(watch);
    if (--f.refs === 0) {
      f.stop();
      if (feeds.get(key) === f) feeds.delete(key);
    }
  };
}
