import { ExchangeClient, HttpTransport, InfoClient, SubscriptionClient, WebSocketTransport } from "@nktkas/hyperliquid";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { platform } from "@/platform";
import type { Network } from "./account";

// Hyperliquid's API and feed, per network. The web app reaches them through
// the Mac mini's relay (platform.route); the extension calls them directly.
const API_URL: Record<Network, string> = { mainnet: "https://api.hyperliquid.xyz", testnet: "https://api.hyperliquid-testnet.xyz" };
const WS_URL: Record<Network, string> = { mainnet: "wss://api.hyperliquid.xyz/ws", testnet: "wss://api.hyperliquid-testnet.xyz/ws" };

const transports = new Map<Network, HttpTransport>();

function transport(network: Network): HttpTransport {
  let t = transports.get(network);
  if (!t) {
    t = new HttpTransport({ isTestnet: network === "testnet", apiUrl: platform.route(API_URL[network]) });
    transports.set(network, t);
  }
  return t;
}

export function infoClient(network: Network): InfoClient {
  return new InfoClient({ transport: transport(network) });
}

export function exchangeClient(network: Network, key: Hex): ExchangeClient {
  return new ExchangeClient({ transport: transport(network), wallet: privateKeyToAccount(key) });
}

// One websocket per network per page, opened on first use. The SDK reconnects
// and resubscribes on its own.
const subscriptions = new Map<Network, SubscriptionClient>();

export function subscriptionClient(network: Network): SubscriptionClient {
  let c = subscriptions.get(network);
  if (!c) {
    c = new SubscriptionClient({ transport: new WebSocketTransport({ isTestnet: network === "testnet", url: platform.route(WS_URL[network]) }) });
    subscriptions.set(network, c);
  }
  return c;
}
