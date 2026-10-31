// Every origin the app sends requests to. The extension's host_permissions
// (wxt.config.ts) are built from this list, and the web app's relay on the
// Mac mini may reach exactly these hosts (webhost.RelayHosts; a Go test keeps
// the two equal).
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
