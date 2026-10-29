import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Network } from "@/lib/account";
import { exchangeClient, infoClient } from "@/lib/hyperliquid";
import { buildMarkets, marketByCoin, usdcTokenId } from "@/lib/markets";
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

export const useFills = () => useAccountQuery("fills", (n, user) => infoClient(n).userFills({ user }), HISTORY_MS);

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
      if (!client) throw new Error(opts.userSigned ? "This action needs the master key" : "No signing key for this mode");
      return action(client, args);
    },
    onSettled: () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "markets" }),
  });
}
