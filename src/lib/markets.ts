import type { AllPerpMetasResponse, MetaAndAssetCtxsResponse, SpotMetaAndAssetCtxsResponse } from "@nktkas/hyperliquid/api/info";

export type MarketKind = "perp" | "spot";

export type MarginMode = "normal" | "noCross" | "strictIsolated";

export interface Market {
  kind: MarketKind;
  // Symbol: "BTC" or "TSLA" for perps, "HYPE/USDC" for spot.
  name: string;
  // What lists show: the name, plus the dex for HIP-3 perps, whose symbols
  // repeat across dexs ("TSLA (xyz)", "TSLA (flx)").
  label: string;
  // Perp dex name; "" for the first (validator-operated) dex and for spot.
  dex: string;
  // Collateral token for perps (USDC, or USDH/USDE/USDT0 on some HIP-3 dexs);
  // the quote token for spot.
  collateral: string;
  // Perps: "noCross" allows only isolated margin, "strictIsolated" also keeps
  // margin from being removed. Null for spot.
  marginMode: MarginMode | null;
  // HIP-3 growth mode: fees reduced by >=90% (trade[XYZ] fee docs).
  growthMode: boolean;
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
  // Perps only: open interest in base units. The API field is unitless in the
  // docs; magnitudes (BTC ~42k at ~$81k = ~$3.4B) show it counts coins.
  openInterest: number | null;
}

// Hyperliquid "Asset IDs" docs: spot is 10000 + the pair's universe index;
// builder-deployed (HIP-3) perps are 100000 + perp_dex_index * 10000 +
// index_in_meta, named "{dex}:{coin}".
const SPOT_ASSET_OFFSET = 10_000;
const HIP3_ASSET_OFFSET = 100_000;
const HIP3_DEX_STRIDE = 10_000;

export type PerpCtx = MetaAndAssetCtxsResponse[1][number];
type PerpAsset = AllPerpMetasResponse[number]["universe"][number];

// HIP-3 dexs: allPerpMetas (index = perp dex index, 0 = main) and the price
// contexts per dex name, from the allDexsAssetCtxs feed or metaAndAssetCtxs.
export interface Hip3Input {
  metas: AllPerpMetasResponse;
  ctxs: Map<string, PerpCtx[]>;
}

function marginModeOf(asset: PerpAsset): MarginMode {
  const mode = (asset as { marginMode?: string }).marginMode;
  if (mode === "noCross" || mode === "strictIsolated") return mode;
  // onlyIsolated is deprecated and means strictIsolated or noCross.
  return asset.onlyIsolated ? "noCross" : "normal";
}

function perpMarket(asset: PerpAsset, ctx: PerpCtx, assetId: number, dex: string, collateral: string): Market {
  const name = dex ? asset.name.slice(dex.length + 1) : asset.name;
  return {
    kind: "perp",
    name,
    label: dex ? `${name} (${dex})` : name,
    dex,
    collateral,
    marginMode: marginModeOf(asset),
    growthMode: (asset as { growthMode?: string }).growthMode === "enabled",
    coin: asset.name,
    assetId,
    szDecimals: asset.szDecimals,
    maxLeverage: asset.maxLeverage,
    ...priceFields("perp", ctx),
  };
}

export function buildMarkets(
  [perpMeta, perpCtxs]: MetaAndAssetCtxsResponse,
  [spotMeta, spotCtxs]: SpotMetaAndAssetCtxsResponse,
  hip3?: Hip3Input,
): Market[] {
  const tokens = new Map(spotMeta.tokens.map((t) => [t.index, t]));
  const tokenName = (index: number) => tokens.get(index)?.name ?? `token ${index}`;

  const perps: Market[] = [];
  perpMeta.universe.forEach((asset, index) => {
    const ctx = perpCtxs[index];
    if (!ctx || asset.isDelisted) return;
    perps.push(perpMarket(asset, ctx, index, "", tokenName(perpMeta.collateralToken)));
  });

  hip3?.metas.forEach((meta, dexIndex) => {
    if (dexIndex === 0) return;
    const first = meta.universe[0]?.name ?? "";
    const dex = first.slice(0, first.indexOf(":"));
    const ctxs = dex ? hip3.ctxs.get(dex) : undefined;
    if (!ctxs) return;
    meta.universe.forEach((asset, index) => {
      const ctx = ctxs[index];
      if (!ctx || asset.isDelisted) return;
      perps.push(perpMarket(asset, ctx, HIP3_ASSET_OFFSET + dexIndex * HIP3_DEX_STRIDE + index, dex, tokenName(meta.collateralToken)));
    });
  });

  const spotCtxByCoin = new Map(spotCtxs.map((c) => [c.coin, c]));
  const spots: Market[] = [];
  for (const pair of spotMeta.universe) {
    const base = tokens.get(pair.tokens[0]);
    const quote = tokens.get(pair.tokens[1]);
    const ctx = spotCtxByCoin.get(pair.name);
    if (!base || !quote || !ctx) continue;
    const name = `${base.name}/${quote.name}`;
    spots.push({
      kind: "spot",
      name,
      label: name,
      dex: "",
      collateral: quote.name,
      marginMode: null,
      growthMode: false,
      coin: pair.name,
      assetId: SPOT_ASSET_OFFSET + pair.index,
      szDecimals: base.szDecimals,
      maxLeverage: null,
      ...priceFields("spot", ctx),
    });
  }

  const byVolume = (a: Market, b: Market) => b.dayNtlVlm - a.dayNtlVlm;
  return [...perps.sort(byVolume), ...spots.sort(byVolume)];
}

// The price fields of a perp or spot asset context (info and websocket share
// the shape); funding and open interest exist for perps only.
interface PriceCtx {
  markPx: string;
  midPx: string | null;
  prevDayPx: string;
  dayNtlVlm: string;
  funding?: string;
  openInterest?: string;
}

function priceFields(kind: MarketKind, ctx: PriceCtx) {
  return {
    markPx: Number(ctx.markPx),
    midPx: ctx.midPx === null ? null : Number(ctx.midPx),
    prevDayPx: Number(ctx.prevDayPx),
    dayNtlVlm: Number(ctx.dayNtlVlm),
    funding: kind === "perp" ? Number(ctx.funding) : null,
    openInterest: kind === "perp" ? Number(ctx.openInterest) : null,
  };
}

// Applies one market's live context (activeAssetCtx / activeSpotAssetCtx feed)
// between full market refreshes. Unchanged markets keep their identity.
export function withLiveCtx<T extends { markets: Market[]; byCoin: Map<string, Market> }>(data: T, coin: string, ctx: PriceCtx): T {
  const prev = data.byCoin.get(coin);
  if (!prev) return data;
  const next = { ...prev, ...priceFields(prev.kind, ctx) };
  const byCoin = new Map(data.byCoin);
  byCoin.set(coin, next);
  return { ...data, markets: data.markets.map((m) => (m.coin === coin ? next : m)), byCoin };
}

// What the markets query holds: the raw definitions (kept so each price feed
// event can rebuild every market) and the latest HIP-3 contexts per dex.
export interface RawMarkets {
  perp: MetaAndAssetCtxsResponse;
  spot: SpotMetaAndAssetCtxsResponse;
  metas: AllPerpMetasResponse;
}

export interface MarketData {
  markets: Market[];
  byCoin: Map<string, Market>;
  usdcToken: string;
  raw: RawMarkets;
  hip3Ctxs: Map<string, PerpCtx[]>;
}

export function marketData(raw: RawMarkets, hip3Ctxs: Map<string, PerpCtx[]>): MarketData {
  const markets = buildMarkets(raw.perp, raw.spot, { metas: raw.metas, ctxs: hip3Ctxs });
  return { markets, byCoin: marketByCoin(markets), usdcToken: usdcTokenId(raw.spot[0]), raw, hip3Ctxs };
}

// Applies an allDexsAssetCtxs event: [dex, contexts] for every perp dex, ""
// being the main dex. Dexs missing from the event keep their last contexts.
export function withDexCtxs(data: MarketData, entries: [string, PerpCtx[]][]): MarketData {
  const hip3Ctxs = new Map(data.hip3Ctxs);
  let perp = data.raw.perp;
  for (const [dex, ctxs] of entries) {
    if (dex === "") perp = [perp[0], ctxs];
    else hip3Ctxs.set(dex, ctxs);
  }
  return marketData({ ...data.raw, perp }, hip3Ctxs);
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
  // Not reserved by open orders (total - hold), as Hyperliquid's "Available Balance".
  available: number;
  usd: number | null;
}

// Non-zero spot balances, largest USD value first; unpriced tokens last.
export function spotHoldings(balances: { coin: string; total: string; hold: string }[], markets: Market[]): SpotHolding[] {
  return balances
    .filter((b) => Number(b.total) !== 0)
    .map((b) => {
      const price = spotTokenPrice(b.coin, markets);
      return { coin: b.coin, total: b.total, available: freeBalance(b), usd: price === null ? null : Number(b.total) * price };
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
