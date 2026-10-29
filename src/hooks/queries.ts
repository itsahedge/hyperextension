import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Network } from "@/lib/account";
import { exchangeClient, infoClient } from "@/lib/hyperliquid";
import { buildMarkets, marketByCoin, usdcTokenId } from "@/lib/markets";
import { CCTP_CONFIG, fetchFeeQuote } from "@/lib/cctp";
import { arbitrumBalances } from "@/lib/cctpClient";
import { loadFavorites, toggleStoredFavorite } from "@/lib/favorites";
import { loadPrefs } from "@/lib/prefs";
import { fetchDepositAddress, type UnitAsset } from "@/lib/unit";
import { useUnlocked } from "./session";

const LIVE_MS = 5_000;
const MARKETS_MS = 10_000;
const HISTORY_MS = 30_000;
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

function useAccountQuery<T>(name: string, fetch: (network: Network, user: `0x${string}`) => Promise<T>, interval: number) {
  const { config } = useUnlocked();
  return useQuery({
    queryKey: [name, config.network, config.address],
    queryFn: () => fetch(config.network, config.address),
    refetchInterval: interval,
  });
}

export const usePerpState = () =>
  useAccountQuery("perpState", (n, user) => infoClient(n).clearinghouseState({ user }), LIVE_MS);

export const useSpotState = () =>
  useAccountQuery("spotState", (n, user) => infoClient(n).spotClearinghouseState({ user }), LIVE_MS);

export const useOpenOrders = () =>
  useAccountQuery("openOrders", (n, user) => infoClient(n).frontendOpenOrders({ user }), LIVE_MS);

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
  return useQuery({
    queryKey: ["activeAsset", config.network, config.address, coin],
    queryFn: () => infoClient(config.network).activeAssetData({ user: config.address, coin: coin! }),
    enabled: coin !== null,
    refetchInterval: LIVE_MS,
  });
}

export function useBook(network: Network, coin: string) {
  return useQuery({
    queryKey: ["book", network, coin],
    queryFn: async () => {
      const book = await infoClient(network).l2Book({ coin });
      const bid = Number(book?.levels[0][0]?.px ?? 0);
      const ask = Number(book?.levels[1][0]?.px ?? 0);
      return { bid, ask };
    },
    refetchInterval: 3_000,
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
    LIVE_MS,
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
export function useExchange<TArgs, TResult>(
  action: (client: ReturnType<typeof exchangeClient>, args: TArgs) => Promise<TResult>,
  opts: { userSigned?: boolean } = {},
) {
  const { config, secrets, signer } = useUnlocked();
  const queryClient = useQueryClient();
  const key = opts.userSigned ? secrets.masterKey : signer;
  const client = useMemo(() => (key ? exchangeClient(config.network, key) : null), [config.network, key]);

  return useMutation({
    mutationFn: (args: TArgs) => {
      if (!client) throw new Error("This action needs the master key");
      return action(client, args);
    },
    onSettled: () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "markets" }),
  });
}
