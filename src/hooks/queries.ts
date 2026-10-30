import type { ISubscription, SubscriptionClient } from "@nktkas/hyperliquid";
import type {
  ActiveAssetCtxEvent,
  ActiveAssetDataEvent,
  ActiveSpotAssetCtxEvent,
  ClearinghouseStateEvent,
  L2BookEvent,
  OpenOrdersEvent,
  SpotStateEvent,
} from "@nktkas/hyperliquid/api/subscription";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Network } from "@/lib/account";
import { exchangeClient, infoClient } from "@/lib/hyperliquid";
import { buildMarkets, marketByCoin, usdcTokenId, withLiveCtx, type Market } from "@/lib/markets";
import { CCTP_CONFIG, fetchFeeQuote } from "@/lib/cctp";
import { arbitrumBalances } from "@/lib/cctpClient";
import { loadFavorites, toggleStoredFavorite } from "@/lib/favorites";
import { loadPrefs } from "@/lib/prefs";
import { withMasterKey, type Auth } from "@/lib/session";
import { fetchDepositAddress, type UnitAsset } from "@/lib/unit";
import { useLiveFeed } from "./live";
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

export function useMarketData(network: Network) {
  return useQuery({
    queryKey: ["markets", network],
    queryFn: async () => {
      const info = infoClient(network);
      const [perp, spot] = await Promise.all([info.metaAndAssetCtxs(), info.spotMetaAndAssetCtxs()]);
      const markets = buildMarkets(perp, spot);
      return { markets, byCoin: marketByCoin(markets), usdcToken: usdcTokenId(spot[0]) };
    },
    refetchInterval: MARKETS_MS,
  });
}

type MarketData = NonNullable<ReturnType<typeof useMarketData>["data"]>;

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

export const useOpenOrders = () =>
  useAccountQuery("openOrders", (n, user) => infoClient(n).frontendOpenOrders({ user }), ORDERS_MS, {
    subscribe: (c, user, l, o) => c.openOrders({ user }, l, o),
    apply: (e: OpenOrdersEvent) => (e.dex === "" ? e.orders : undefined),
  });

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

function bookTop(book: { levels: [{ px: string }[], { px: string }[]] } | null) {
  return { bid: Number(book?.levels[0][0]?.px ?? 0), ask: Number(book?.levels[1][0]?.px ?? 0) };
}

export function useBook(network: Network, coin: string) {
  const queryKey = ["book", network, coin];
  const live = useLiveFeed<L2BookEvent, ReturnType<typeof bookTop>>(network, queryKey, (c, l, o) => c.l2Book({ coin }, l, o), (e) => bookTop(e));
  return useQuery({
    queryKey,
    queryFn: async () => bookTop(await infoClient(network).l2Book({ coin })),
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
