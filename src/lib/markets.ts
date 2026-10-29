import type { MetaAndAssetCtxsResponse, SpotMetaAndAssetCtxsResponse } from "@nktkas/hyperliquid/api/info";

export type MarketKind = "perp" | "spot";

export interface Market {
  kind: MarketKind;
  // Display name: "BTC" for perps, "HYPE/USDC" for spot.
  name: string;
  // Key the API uses in positions, open orders, and fills: the perp name, or
  // the spot universe name ("@107", or "PURR/USDC" for legacy pairs).
  coin: string;
  assetId: number;
  szDecimals: number;
  maxLeverage: number | null;
  markPx: number;
  midPx: number | null;
  prevDayPx: number;
  dayNtlVlm: number;
  funding: number | null;
}

// Spot asset ids are 10000 + the pair's universe index (Hyperliquid "Asset IDs" docs).
const SPOT_ASSET_OFFSET = 10_000;

export function buildMarkets(
  [perpMeta, perpCtxs]: MetaAndAssetCtxsResponse,
  [spotMeta, spotCtxs]: SpotMetaAndAssetCtxsResponse,
): Market[] {
  const perps: Market[] = [];
  perpMeta.universe.forEach((asset, index) => {
    const ctx = perpCtxs[index];
    if (!ctx || asset.isDelisted) return;
    perps.push({
      kind: "perp",
      name: asset.name,
      coin: asset.name,
      assetId: index,
      szDecimals: asset.szDecimals,
      maxLeverage: asset.maxLeverage,
      markPx: Number(ctx.markPx),
      midPx: ctx.midPx === null ? null : Number(ctx.midPx),
      prevDayPx: Number(ctx.prevDayPx),
      dayNtlVlm: Number(ctx.dayNtlVlm),
      funding: Number(ctx.funding),
    });
  });

  const tokens = new Map(spotMeta.tokens.map((t) => [t.index, t]));
  const spotCtxByCoin = new Map(spotCtxs.map((c) => [c.coin, c]));
  const spots: Market[] = [];
  for (const pair of spotMeta.universe) {
    const base = tokens.get(pair.tokens[0]);
    const quote = tokens.get(pair.tokens[1]);
    const ctx = spotCtxByCoin.get(pair.name);
    if (!base || !quote || !ctx) continue;
    spots.push({
      kind: "spot",
      name: `${base.name}/${quote.name}`,
      coin: pair.name,
      assetId: SPOT_ASSET_OFFSET + pair.index,
      szDecimals: base.szDecimals,
      maxLeverage: null,
      markPx: Number(ctx.markPx),
      midPx: ctx.midPx === null ? null : Number(ctx.midPx),
      prevDayPx: Number(ctx.prevDayPx),
      dayNtlVlm: Number(ctx.dayNtlVlm),
      funding: null,
    });
  }

  const byVolume = (a: Market, b: Market) => b.dayNtlVlm - a.dayNtlVlm;
  return [...perps.sort(byVolume), ...spots.sort(byVolume)];
}

// Token identifier for sendAsset-style actions: "NAME:0x<tokenId>".
export function usdcTokenId(spotMeta: SpotMetaAndAssetCtxsResponse[0]): string {
  const usdc = spotMeta.tokens.find((t) => t.name === "USDC");
  if (!usdc) throw new Error("USDC missing from spot metadata");
  return `${usdc.name}:${usdc.tokenId}`;
}

export function marketByCoin(markets: Market[]): Map<string, Market> {
  return new Map(markets.map((m) => [m.coin, m]));
}

// Spendable part of a spot balance. Portfolio-margin accounts report negative
// `hold` when borrowing, so total - hold can exceed total; clamp to [0, total].
export function freeBalance(b: { total: string; hold: string }): number {
  const total = Number(b.total);
  return Math.max(0, Math.min(total, total - Number(b.hold)));
}

// USD price of a spot token via its /USDC pair; null when no such pair exists.
export function spotTokenPrice(token: string, markets: Market[]): number | null {
  if (token === "USDC") return 1;
  const pair = markets.find((m) => m.kind === "spot" && m.name === `${token}/USDC`);
  return pair ? pair.markPx : null;
}

export interface SpotHolding {
  coin: string;
  // API decimal string, kept as-is for display precision.
  total: string;
  usd: number | null;
}

// Non-zero spot balances, largest USD value first; unpriced tokens last.
export function spotHoldings(balances: { coin: string; total: string }[], markets: Market[]): SpotHolding[] {
  return balances
    .filter((b) => Number(b.total) !== 0)
    .map((b) => {
      const price = spotTokenPrice(b.coin, markets);
      return { coin: b.coin, total: b.total, usd: price === null ? null : Number(b.total) * price };
    })
    .sort((a, b) => (b.usd ?? -Infinity) - (a.usd ?? -Infinity) || a.coin.localeCompare(b.coin));
}

export function spotUsdValue(balances: { coin: string; total: string }[], markets: Market[]): number {
  let sum = 0;
  for (const b of balances) {
    const price = spotTokenPrice(b.coin, markets);
    if (price !== null) sum += Number(b.total) * price;
  }
  return sum;
}
