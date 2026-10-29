import { getAddress, type Address } from "viem";
import type { Network } from "./account";

// Unit Protocol deposit addresses (docs.hyperunit.xyz). GET /gen returns a
// permanent source-chain address tied to the Hyperliquid destination, plus
// guardian signatures. An address is shown only if at least THRESHOLD of the
// network's guardians signed it for this exact destination.
//
//   GET /gen/{src}/hyperliquid/{asset}/{dst}
//        │  { address, signatures: { [nodeId]: base64 r‖s } }
//   verify ECDSA P-256 / SHA-256 per guardian over
//        current: "{nodeId}:user-{coinType}-hyperliquid-{dst}-{address}"
//        legacy:  "{nodeId}:{dst}-hyperliquid-{asset}-{address}-{src}-deposit"
//        │  dst is EIP-55 checksummed; address exactly as returned
//   >= 2 of 3 verified  ──▶  display

export const UNIT_API: Record<Network, string> = {
  mainnet: "https://api.hyperunit.xyz",
  testnet: "https://api.hyperunit-testnet.xyz",
};

// From Unit's "Guardian Signatures" page.
export const GUARDIANS: Record<Network, { nodeId: string; publicKey: string }[]> = {
  mainnet: [
    { nodeId: "unit-node", publicKey: "04dc6f89f921dc816aa69b687be1fcc3cc1d48912629abc2c9964e807422e1047e0435cb5ba0fa53cb9a57a9c610b4e872a0a2caedda78c4f85ebafcca93524061" },
    { nodeId: "hl-node", publicKey: "048633ea6ab7e40cdacf37d1340057e84bb9810de0687af78d031e9b07b65ad4ab379180ab55075f5c2ebb96dab30d2c2fab49d5635845327b6a3c27d20ba4755b" },
    { nodeId: "field-node", publicKey: "04ae2ab20787f816ea5d13f36c4c4f7e196e29e867086f3ce818abb73077a237f841b33ada5be71b83f4af29f333dedc5411ca4016bd52ab657db2896ef374ce99" },
  ],
  testnet: [
    { nodeId: "node-1", publicKey: "04bab844e8620c4a1ec304df6284cd6fdffcde79b3330a7bffb1e4cecfee72d02a7c1f3a4415b253dc8d6ca2146db170e1617605cc8a4160f539890b8a24712152" },
    { nodeId: "hl-node-testnet", publicKey: "04502d20a0d8d8aaea9395eb46d50ad2d8278c1b3a3bcdc200d531253612be23f5f2e9709bf3a3a50d1447281fa81aca0bf2ac2a6a3cb8a12978381d73c24bb2d9" },
    { nodeId: "field-node", publicKey: "04e674a796ff01d6b74f4ee4079640729797538cdb4926ec333ce1bd18414ef7f22c1a142fd76dca120614045273f30338cd07d79bc99872c76151756aaec0f8e8" },
  ],
};
export const THRESHOLD = 2;

export type UnitChain = "bitcoin" | "ethereum" | "solana" | "plasma" | "monad" | "zcash" | "avalanche" | "base";

// EVM source chains share one address per destination, signed with coinType
// "ethereum" (verified against live testnet signatures).
const EVM_CHAINS: ReadonlySet<UnitChain> = new Set(["ethereum", "plasma", "monad", "avalanche", "base"]);
export const coinTypeFor = (chain: UnitChain) => (EVM_CHAINS.has(chain) ? "ethereum" : chain);

export const CHAIN_NAMES: Record<Network, Record<UnitChain, string>> = {
  mainnet: { bitcoin: "Bitcoin", ethereum: "Ethereum", solana: "Solana", plasma: "Plasma", monad: "Monad", zcash: "Zcash", avalanche: "Avalanche C-Chain", base: "Base" },
  testnet: {
    bitcoin: "Bitcoin Signet",
    ethereum: "Ethereum Sepolia",
    solana: "Solana Devnet",
    plasma: "Plasma Testnet",
    monad: "Monad Testnet",
    zcash: "Zcash Testnet",
    avalanche: "Avalanche Fuji",
    base: "Base Sepolia",
  },
};

export interface UnitAsset {
  // API asset id.
  id: string;
  chain: UnitChain;
  symbol: string;
  name: string;
  // Unit's minimum; smaller deposits are not processed.
  minimum: string;
}

// Unit's "Generate Address" minimums table. API ids checked on testnet
// (SPX6900 is "spxs"; Doublezero is "2z").
export const UNIT_ASSETS: UnitAsset[] = [
  { id: "btc", chain: "bitcoin", symbol: "BTC", name: "Bitcoin", minimum: "0.0003" },
  { id: "eth", chain: "ethereum", symbol: "ETH", name: "Ethereum", minimum: "0.007" },
  { id: "sol", chain: "solana", symbol: "SOL", name: "Solana", minimum: "0.12" },
  { id: "xpl", chain: "plasma", symbol: "XPL", name: "Plasma", minimum: "60" },
  { id: "mon", chain: "monad", symbol: "MON", name: "Monad", minimum: "450" },
  { id: "zec", chain: "zcash", symbol: "ZEC", name: "Zcash", minimum: "0.07" },
  { id: "avax", chain: "avalanche", symbol: "AVAX", name: "Avalanche", minimum: "1.5" },
  { id: "virtual", chain: "base", symbol: "VIRTUAL", name: "Virtual", minimum: "25" },
  { id: "pump", chain: "solana", symbol: "PUMP", name: "Pump", minimum: "5500" },
  { id: "fart", chain: "solana", symbol: "FARTCOIN", name: "Fartcoin", minimum: "55" },
  { id: "bonk", chain: "solana", symbol: "BONK", name: "Bonk", minimum: "1800000" },
  { id: "spxs", chain: "solana", symbol: "SPX6900", name: "SPX6900", minimum: "32" },
  { id: "2z", chain: "solana", symbol: "2Z", name: "Doublezero", minimum: "150" },
  { id: "ansem", chain: "solana", symbol: "ANSEM", name: "Ansem", minimum: "60" },
];

export interface UnitDepositAddress {
  address: string;
  verifiedBy: string[];
}

export function payloads(nodeId: string, asset: UnitAsset, destination: Address, address: string): string[] {
  const dst = getAddress(destination);
  return [
    `${nodeId}:${["user", coinTypeFor(asset.chain), "hyperliquid", dst, address].join("-")}`,
    `${nodeId}:${[dst, "hyperliquid", asset.id, address, asset.chain, "deposit"].join("-")}`,
  ];
}

function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
}

function base64Bytes(b64: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

// Guardians whose signature covers this address for this destination.
export async function verifiedGuardians(network: Network, asset: UnitAsset, destination: Address, address: string, signatures: Record<string, unknown>): Promise<string[]> {
  const results = await Promise.all(
    GUARDIANS[network].map(async ({ nodeId, publicKey }) => {
      const sig = signatures[nodeId];
      const bytes = typeof sig === "string" ? base64Bytes(sig) : null;
      if (!bytes || bytes.length !== 64) return null;
      const key = await crypto.subtle.importKey("raw", hexBytes(publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      for (const payload of payloads(nodeId, asset, destination, address)) {
        if (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, bytes, new TextEncoder().encode(payload))) return nodeId;
      }
      return null;
    }),
  );
  return results.filter((id): id is string => id !== null);
}

// Throws unless the response is a well-formed address signed by THRESHOLD
// guardians for this destination; never returns an unverified address.
export async function verifyDepositResponse(network: Network, asset: UnitAsset, destination: Address, body: unknown): Promise<UnitDepositAddress> {
  const b = (body ?? {}) as { address?: unknown; signatures?: unknown; error?: unknown };
  if (typeof b.error === "string") throw new Error(`Unit: ${b.error}`);
  if (typeof b.address !== "string" || !b.address || typeof b.signatures !== "object" || b.signatures === null) {
    throw new Error("Unexpected response from Unit");
  }
  const verifiedBy = await verifiedGuardians(network, asset, destination, b.address, b.signatures as Record<string, unknown>);
  if (verifiedBy.length < THRESHOLD) {
    throw new Error(`Refusing Unit address: only ${verifiedBy.length} of ${GUARDIANS[network].length} guardian signatures verified (need ${THRESHOLD})`);
  }
  return { address: b.address, verifiedBy };
}

export async function fetchDepositAddress(network: Network, asset: UnitAsset, destination: Address): Promise<UnitDepositAddress> {
  const dst = getAddress(destination);
  const res = await fetch(`${UNIT_API[network]}/gen/${asset.chain}/hyperliquid/${encodeURIComponent(asset.id)}/${dst}`);
  const body = await res.json().catch(() => null);
  if (res.status === 403 && !body) {
    throw new Error("Unit refused the request (HTTP 403). Unit blocks access from prohibited jurisdictions.");
  }
  if (!res.ok && !(body && typeof body.error === "string")) throw new Error(`Unit API returned ${res.status}`);
  return verifyDepositResponse(network, asset, dst, body);
}
