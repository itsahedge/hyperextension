// Every origin the app sends requests to. The extension's host_permissions
// (wxt.config.ts) and the web app's Content-Security-Policy connect-src
// (vite.web.config.ts) are both built from these lists.
export const API_ORIGINS = [
  "https://api.hyperliquid.xyz",
  "https://api.hyperliquid-testnet.xyz",
  // USDC deposits via Circle CCTP: Arbitrum RPC and Circle's fee API.
  "https://arb1.arbitrum.io",
  "https://sepolia-rollup.arbitrum.io",
  "https://iris-api.circle.com",
  "https://iris-api-sandbox.circle.com",
  // Unit Protocol deposit addresses (BTC, ETH, SOL and others).
  "https://api.hyperunit.xyz",
  "https://api.hyperunit-testnet.xyz",
] as const;

// Hyperliquid's websocket feeds (@nktkas/hyperliquid WebSocketTransport).
export const WEBSOCKET_ORIGINS = ["wss://api.hyperliquid.xyz", "wss://api.hyperliquid-testnet.xyz"] as const;
