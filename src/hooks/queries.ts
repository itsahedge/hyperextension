import type { ISubscription, SubscriptionClient } from "@nktkas/hyperliquid";
import type { ClearinghouseStateResponse, FrontendOpenOrdersResponse } from "@nktkas/hyperliquid/api/info";
import type {
  ActiveAssetCtxEvent,
  ActiveAssetDataEvent,
  ActiveSpotAssetCtxEvent,
  AllDexsAssetCtxsEvent,
  AllDexsClearinghouseStateEvent,
  ClearinghouseStateEvent,
  L2BookEvent,
  OpenOrdersEvent,
  SpotStateEvent,
} from "@nktkas/hyperliquid/api/subscription";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Network } from "@/lib/account";
import { exchangeClient, infoClient } from "@/lib/hyperliquid";
import type { BookLevel } from "@/lib/liquidity";
import { dexOfCoin, marketData, perpDexNames, withDexCtxs, withLiveCtx, type Market, type MarketData, type PerpCtx, type RawMarkets } from "@/lib/markets";
import { CCTP_CONFIG, fetchFeeQuote } from "@/lib/cctp";
import { arbitrumBalances } from "@/lib/cctpClient";
import { loadFavorites, toggleStoredFavorite } from "@/lib/favorites";
import { loadPrefs } from "@/lib/prefs";
import { withMasterKey, type Auth } from "@/lib/session";
import { fetchDepositAddress, type UnitAsset } from "@/lib/unit";
import { useLiveFeed, useLiveFeeds } from "./live";
import { useUnlocked } from "./session";

// Polling intervals. Every REST call shares Hyperliquid's 1200/min weight
// budget per IP with order submission (rate-limit docs: weight 2 for
// clearinghouseState/spotClearinghouseState/l2Book, 20 for most others), so
// live data comes from websocket feeds (hooks/live.ts) and a query whose feed
// is confirmed only polls every FEED_FALLBACK_MS as a safety net.
const LIVE_MS = 5_000;
const ORDERS_MS = 15_000;
const MARKETS_MS = 30_000;
const HISTORY_MS = 30_000;
const FEED_FALLBACK_MS = 60_000;
const DAY_MS = 86_400_000;

// How long the all-dex price feed may take to confirm before HIP-3 prices
// are fetched over REST instead (10 dexs x weight 20).
const FEED_GRACE_MS = 4_000;

// HIP-3 prices per dex over REST: only when the allDexsAssetCtxs feed is not up.
async function fetchHip3Ctxs(network: Network, metas: RawMarkets["metas"]): Promise<Map<string, PerpCtx[]>> {
  const dexs = perpDexNames(metas).slice(1);
  const info = infoClient(network);
  const results = await Promise.all(dexs.map(async (dex) => [dex, (await info.metaAndAssetCtxs({ dex }))[1]] as const));
  return new Map(results);
}

// The latest allDexsAssetCtxs entries per network. The feed's first event can
// arrive before the definitions load; the query function starts from it.
const latestDexCtxs = new Map<Network, [string, PerpCtx[]][]>();

// Every perp dex (main + HIP-3) and spot. Definitions come over REST; prices
// for every perp dex stream from the allDexsAssetCtxs feed (~120 KB every few
// seconds), which also keeps HIP-3 markets listed without per-dex requests.
export function useMarketData(network: Network) {
  const queryClient = useQueryClient();
  const queryKey = ["markets", network];
  const live = useLiveFeed<AllDexsAssetCtxsEvent, MarketData>(
    network,
    queryKey,
    (c, l, o) => c.allDexsAssetCtxs(l, o),
    (e, prev) => {
      latestDexCtxs.set(network, e.ctxs);
      return prev ? withDexCtxs(prev, e.ctxs) : prev;
    },
  );
  const [restHip3, setRestHip3] = useState(false);
  useEffect(() => {
    if (live) {
      setRestHip3(false);
      return;
    }
    const timer = setTimeout(() => {
      setRestHip3(true);
      void queryClient.invalidateQueries({ queryKey: ["markets", network] });
    }, FEED_GRACE_MS);
    return () => clearTimeout(timer);
  }, [live, network, queryClient]);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<MarketData> => {
      const info = infoClient(network);
      const [perp, spot, metas] = await Promise.all([info.metaAndAssetCtxs(), info.spotMetaAndAssetCtxs(), info.allPerpMetas()]);
      if (restHip3) return marketData({ perp, spot, metas }, await fetchHip3Ctxs(network, metas));
      // HIP-3 prices come from the feed: start from its latest event so those
      // markets are listed (main perps keep the fresh REST contexts).
      const fromFeed = (latestDexCtxs.get(network) ?? []).filter(([dex]) => dex !== "");
      const prev = queryClient.getQueryData<MarketData>(["markets", network]);
      return withDexCtxs(marketData({ perp, spot, metas }, prev?.hip3Ctxs ?? new Map()), fromFeed);
    },
    refetchInterval: live ? 5 * 60_000 : MARKETS_MS,
  });
}

// Live prices for the market being traded, between full market refreshes.
export function useLiveMarketCtx(network: Network, market: Market) {
  useLiveFeed<ActiveAssetCtxEvent | ActiveSpotAssetCtxEvent, MarketData>(
    network,
    ["markets", network],
    (c, l, o) => (market.kind === "perp" ? c.activeAssetCtx({ coin: market.coin }, l, o) : c.activeSpotAssetCtx({ coin: market.coin }, l, o)),
    (e, prev) => (prev && e.coin === market.coin ? withLiveCtx(prev, e.coin, e.ctx) : prev),
    `ctx:${market.coin}`,
  );
}

interface Feed<E, T> {
  subscribe: (client: SubscriptionClient, user: `0x${string}`, listener: (event: E) => void, options: { onError: () => void }) => Promise<ISubscription>;
  // undefined: the event does not apply (another dex); keep the cached value.
  apply: (event: E) => T | undefined;
}

function useAccountQuery<T, E = never>(name: string, fetch: (network: Network, user: `0x${string}`) => Promise<T>, interval: number, feed?: Feed<E, T>) {
  const { config } = useUnlocked();
  const queryKey = [name, config.network, config.address];
  const live = useLiveFeed<E, T>(config.network, queryKey, feed ? (c, l, o) => feed.subscribe(c, config.address, l, o) : null, (e, prev) =>
    feed ? (feed.apply(e) ?? prev) : prev,
  );
  return useQuery({
    queryKey,
    queryFn: () => fetch(config.network, config.address),
    refetchInterval: live ? FEED_FALLBACK_MS : interval,
  });
}

// Feeds without a dex parameter carry the main dex (dex ""), which includes spot.
export const usePerpState = () =>
  useAccountQuery("perpState", (n, user) => infoClient(n).clearinghouseState({ user }), LIVE_MS, {
    subscribe: (c, user, l, o) => c.clearinghouseState({ user }, l, o),
    apply: (e: ClearinghouseStateEvent) => (e.dex === "" ? e.clearinghouseState : undefined),
  });

export const useSpotState = () =>
  useAccountQuery("spotState", (n, user) => infoClient(n).spotClearinghouseState({ user }), LIVE_MS, {
    subscribe: (c, user, l, o) => c.spotState({ user }, l, o),
    apply: (e: SpotStateEvent) => e.spotState,
  });

// Every perp dex name, "" first, from the market definitions.
export function usePerpDexs(network: Network): string[] | undefined {
  const metas = useMarketData(network).data?.raw.metas;
  return useMemo(() => (metas ? perpDexNames(metas) : undefined), [metas]);
}

type OpenOrders = FrontendOpenOrdersResponse;

// Open orders on every perp dex. Hyperliquid serves them per dex only (no
// "all" value), so each dex has its own websocket feed; REST asks the main
// dex (which includes spot) and only those other dexs whose feed is not up
// after the grace period.
export function useOpenOrders() {
  const { config } = useUnlocked();
  const dexs = usePerpDexs(config.network);
  const queryClient = useQueryClient();
  const queryKey = ["openOrders", config.network, config.address];
  const live = useLiveFeeds<OpenOrdersEvent, OpenOrders>(
    config.network,
    queryKey,
    dexs,
    (c, dex, l, o) => c.openOrders({ user: config.address, dex }, l, o),
    (dex, e, prev) => (e.dex === dex ? [...(prev ?? []).filter((o) => dexOfCoin(o.coin) !== dex), ...e.orders] : prev),
  );
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGraceOver(true), FEED_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);
  const restDexs = (dexs ?? [""]).filter((d) => d === "" || (graceOver && !live.has(d)));
  const allLive = dexs !== undefined && dexs.every((d) => live.has(d));

  return useQuery({
    queryKey,
    queryFn: async () => {
      const info = infoClient(config.network);
      const fetched = await Promise.all(restDexs.map((dex) => info.frontendOpenOrders({ user: config.address, dex })));
      // Orders of dexs not fetched here come from their feeds; keep them.
      const prev = queryClient.getQueryData<OpenOrders>(queryKey) ?? [];
      return [...prev.filter((o) => !restDexs.includes(dexOfCoin(o.coin))), ...fetched.flat()];
    },
    refetchInterval: allLive ? FEED_FALLBACK_MS : ORDERS_MS,
  });
}

// "unifiedAccount" | "portfolioMargin" | "disabled" | "default" |
// "dexAbstraction". "default" behaves as standard: live "default" accounts
// hold USDC in the perp state, not spot. Unified and
// portfolio margin keep one balance per asset in the spot clearinghouse state
// for spot and every perp dex; per-dex perp states are not meaningful for
// balances there (Hyperliquid "Account abstraction modes" docs).
export const useAbstraction = () =>
  useAccountQuery("abstraction", (n, user) => infoClient(n).userAbstraction({ user }), 5 * 60_000);

export const isUnified = (mode: string | undefined) => mode === "unifiedAccount" || mode === "portfolioMargin";

// Hyperliquid's own account value (spot + every perp dex, any abstraction
// mode): the latest point of portfolio's "day" history, computed at request
// time. Weight 20.
export const useAccountValue = () =>
  useAccountQuery(
    "accountValue",
    async (n, user) => {
      const periods = await infoClient(n).portfolio({ user });
      const last = periods.find(([p]) => p === "day")?.[1].accountValueHistory.at(-1);
      return last ? Number(last[1]) : null;
    },
    HISTORY_MS,
  );

export type PerpStates = [dex: string, state: ClearinghouseStateResponse][];

export const allPositions = (states: PerpStates) => states.flatMap(([, s]) => s.assetPositions.map((p) => p.position));

// Perp account state on every dex (positions, margin), from one
// allDexsClearinghouseState feed; REST asks each dex (weight 2 each).
export function usePerpStates() {
  const { config } = useUnlocked();
  const dexs = usePerpDexs(config.network);
  const queryKey = ["perpStates", config.network, config.address];
  const live = useLiveFeed<AllDexsClearinghouseStateEvent, PerpStates>(
    config.network,
    queryKey,
    (c, l, o) => c.allDexsClearinghouseState({ user: config.address }, l, o),
    (e) => e.clearinghouseStates,
  );
  return useQuery({
    queryKey,
    enabled: dexs !== undefined,
    queryFn: async (): Promise<PerpStates> => {
      const info = infoClient(config.network);
      return Promise.all(dexs!.map(async (dex) => [dex, await info.clearinghouseState({ user: config.address, dex })] as [string, ClearinghouseStateResponse]));
    },
    refetchInterval: live ? FEED_FALLBACK_MS : ORDERS_MS,
  });
}

// At most the 2000 most recent orders (Hyperliquid info endpoint docs).
export const useOrderHistory = () =>
  useAccountQuery("orderHistory", (n, user) => infoClient(n).historicalOrders({ user }), HISTORY_MS);

// aggregateByTime merges the partial fills of an order that crossed several
// resting orders into one row (size summed, size-weighted price), so a trade
// reads like its order. A resting order filled by takers in different blocks
// still shows one row per block. At most the 2000 most recent fills.
export const useFills = () =>
  useAccountQuery("fills", (n, user) => infoClient(n).userFills({ user, aggregateByTime: true }), HISTORY_MS);

export const useFunding = () =>
  useAccountQuery(
    "funding",
    (n, user) => infoClient(n).userFunding({ user, startTime: Date.now() - 7 * DAY_MS }),
    HISTORY_MS,
  );

export const useLedger = () =>
  useAccountQuery(
    "ledger",
    (n, user) => infoClient(n).userNonFundingLedgerUpdates({ user, startTime: Date.now() - 30 * DAY_MS }),
    HISTORY_MS,
  );

// Perps only. Leverage and max trade size per side for one coin.
export function useActiveAsset(coin: string | null) {
  const { config } = useUnlocked();
  const queryKey = ["activeAsset", config.network, config.address, coin];
  const live = useLiveFeed<ActiveAssetDataEvent, ActiveAssetDataEvent>(
    config.network,
    queryKey,
    coin === null ? null : (c, l, o) => c.activeAssetData({ user: config.address, coin }, l, o),
    (e) => e,
  );
  return useQuery({
    queryKey,
    queryFn: () => infoClient(config.network).activeAssetData({ user: config.address, coin: coin! }),
    enabled: coin !== null,
    refetchInterval: live ? FEED_FALLBACK_MS : ORDERS_MS,
  });
}

// Best bid/ask plus the visible levels (20 a side), best first, which size
// how much a market order can fill (lib/liquidity).
export interface BookView {
  bid: number;
  ask: number;
  bids: BookLevel[];
  asks: BookLevel[];
}

function bookView(book: { levels: [{ px: string; sz: string }[], { px: string; sz: string }[]] } | null): BookView {
  const side = (levels: { px: string; sz: string }[] = []) => levels.map((l) => ({ px: Number(l.px), sz: Number(l.sz) }));
  const bids = side(book?.levels[0]);
  const asks = side(book?.levels[1]);
  return { bid: bids[0]?.px ?? 0, ask: asks[0]?.px ?? 0, bids, asks };
}

export function useBook(network: Network, coin: string) {
  const queryKey = ["book", network, coin];
  const live = useLiveFeed<L2BookEvent, BookView>(network, queryKey, (c, l, o) => c.l2Book({ coin }, l, o), (e) => bookView(e));
  return useQuery({
    queryKey,
    queryFn: async () => bookView(await infoClient(network).l2Book({ coin })),
    refetchInterval: live ? FEED_FALLBACK_MS : 3_000,
  });
}

// Running TWAPs. twapHistory returns one row per status change, so keep each
// TWAP's latest row and drop the ones that ended.
export const useActiveTwaps = () =>
  useAccountQuery(
    "twaps",
    async (n, user) => {
      const rows = await infoClient(n).twapHistory({ user });
      const latest = new Map<number, (typeof rows)[number]>();
      for (const row of rows) {
        if (row.twapId === undefined) continue;
        const prev = latest.get(row.twapId);
        if (!prev || row.time >= prev.time) latest.set(row.twapId, row);
      }
      return [...latest.values()].filter((r) => r.status.status === "activated" || r.status.status === "waitingForTrigger");
    },
    // Weight 20 plus more per 20 rows of history; TWAPs change slowly.
    HISTORY_MS,
  );

export function useFavorites(network: Network) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["favorites"], queryFn: loadFavorites, staleTime: Number.POSITIVE_INFINITY });
  const toggle = useMutation({
    mutationFn: (coin: string) => toggleStoredFavorite(network, coin),
    onSuccess: (next) => queryClient.setQueryData(["favorites"], next),
  });
  return { ready: query.isSuccess, list: query.data?.[network] ?? [], toggle: (coin: string) => toggle.mutate(coin) };
}

// Arbitrum USDC and ETH (gas) for the trading account, for CCTP deposits.
export function useArbitrumBalances() {
  const { config } = useUnlocked();
  return useQuery({
    queryKey: ["arbitrumBalances", config.network, config.address],
    queryFn: () => arbitrumBalances(config.network, config.address),
    refetchInterval: HISTORY_MS,
  });
}

export function useCctpFee(network: Network) {
  return useQuery({ queryKey: ["cctpFee", network], queryFn: () => fetchFeeQuote(CCTP_CONFIG[network]), refetchInterval: 60_000 });
}

// Unit addresses are permanent per destination, so one fetch per session.
export function useUnitDepositAddress(asset: UnitAsset | null) {
  const { config } = useUnlocked();
  return useQuery({
    queryKey: ["unitAddress", config.network, config.address, asset?.chain, asset?.id],
    queryFn: () => fetchDepositAddress(config.network, asset!, config.address),
    enabled: asset !== null,
    staleTime: Infinity,
    retry: false,
  });
}

export function usePrefs() {
  return useQuery({ queryKey: ["prefs"], queryFn: loadPrefs, staleTime: Number.POSITIVE_INFINITY });
}

export const useAgents = () => useAccountQuery("agents", (n, user) => infoClient(n).extraAgents({ user }), HISTORY_MS);

// Runs an exchange action with the active signer, then refreshes account data.
export function useExchange<TArgs, TResult>(action: (client: ReturnType<typeof exchangeClient>, args: TArgs) => Promise<TResult>) {
  const { config, signer } = useUnlocked();
  const queryClient = useQueryClient();
  const client = useMemo(() => exchangeClient(config.network, signer), [config.network, signer]);

  return useMutation({
    mutationFn: (args: TArgs) => action(client, args),
    onSettled: () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "markets" }),
  });
}

// A user-signed (master key) exchange action. The key is opened from the
// vault with `auth` for this call only (withMasterKey), never read from the
// session.
export function useMasterAction<TArgs, TResult>(action: (client: ReturnType<typeof exchangeClient>, args: TArgs) => Promise<TResult>) {
  const { config } = useUnlocked();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ auth, args }: { auth: Auth; args: TArgs }) => withMasterKey(auth, (key) => action(exchangeClient(config.network, key), args)),
    onSettled: () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "markets" }),
  });
}
