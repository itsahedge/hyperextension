import { formatPrice } from "@nktkas/hyperliquid/utils";
import type { Market } from "./markets";
import type { OrderSpec } from "./orders";
import { floorSize, MIN_ORDER_USD } from "./sizing";

// A batched order costs 1 + floor(n / 40) IP weight (Hyperliquid rate-limit
// docs), so 50 rungs is a single weight-2 request.
export const MAX_SCALE_ORDERS = 50;
export const MIN_SCALE_ORDERS = 2;

// Skews run from -1 to 1 along the price axis, low price -> high price,
// independent of side: negative bunches toward the low price, positive toward
// the high price, 0 is even.
//
//   price skew: rung i sits at lo + (hi - lo) * t^gamma, t = i / (n - 1),
//               gamma = PRICE_CURVE^(-skew)   (skew 1 -> t^(1/3): packed high)
//   size skew:  weight_i = SIZE_RATIO^(skew * (t_i - 0.5)), t_i being the
//               rung's position on the price axis, so the heaviest rung is at
//               most SIZE_RATIO x the lightest
const PRICE_CURVE = 3;
const SIZE_RATIO = 4;

export interface ScaleInput {
  market: Market;
  isBuy: boolean;
  // Total ladder size: base units, or USD converted at the ladder's
  // size-weighted average price.
  size: { base: number } | { usd: number };
  priceA: number;
  priceB: number;
  count: number;
  priceSkew: number;
  sizeSkew: number;
  postOnly: boolean;
  reduceOnly: boolean;
  // Best bid/ask, to flag rungs that would fill immediately.
  book?: { bid: number; ask: number };
}

export interface ScaleRung {
  px: string;
  sz: string;
}

export interface ScalePlan {
  orders: OrderSpec[];
  // Ascending by price.
  rungs: ScaleRung[];
  totalSize: number;
  notional: number;
  avgPx: number;
  low: number;
  high: number;
  crossing: number;
  warnings: string[];
}

export function scalePositions(count: number, skew: number): number[] {
  const gamma = PRICE_CURVE ** -clampSkew(skew);
  return Array.from({ length: count }, (_, i) => (count === 1 ? 0 : (i / (count - 1)) ** gamma));
}

export function scaleWeights(positions: number[], skew: number): number[] {
  const s = clampSkew(skew);
  return positions.map((t) => SIZE_RATIO ** (s * (t - 0.5)));
}

export function planScale(input: ScaleInput): ScalePlan {
  const { market, count } = input;
  if (!Number.isInteger(count) || count < MIN_SCALE_ORDERS || count > MAX_SCALE_ORDERS) {
    throw new Error(`Total orders must be ${MIN_SCALE_ORDERS} to ${MAX_SCALE_ORDERS}`);
  }
  if (!(input.priceA > 0) || !(input.priceB > 0)) throw new Error("Enter both prices");
  if (input.priceA === input.priceB) throw new Error("Prices are the same; use a limit order");
  const low = Math.min(input.priceA, input.priceB);
  const high = Math.max(input.priceA, input.priceB);

  const positions = scalePositions(count, input.priceSkew);
  const weights = scaleWeights(positions, input.sizeSkew);
  const rawPx = positions.map((t) => low + (high - low) * t);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const weightedPx = rawPx.reduce((acc, px, i) => acc + px * weights[i]!, 0) / weightSum;

  const totalBase = "base" in input.size ? input.size.base : input.size.usd / weightedPx;
  if (!(totalBase > 0)) throw new Error("Size must be greater than zero");

  // Round each rung to a valid tick; rungs that collapse onto the same tick
  // are merged so no two orders share a price.
  const byPx = new Map<string, number>();
  rawPx.forEach((px, i) => {
    const key = formatPrice(px, market.szDecimals, market.kind);
    byPx.set(key, (byPx.get(key) ?? 0) + (totalBase * weights[i]!) / weightSum);
  });
  const warnings: string[] = [];
  if (byPx.size < count) {
    warnings.push(`Orders with duplicate price: ${count} rungs round to ${byPx.size} prices and were merged`);
  }

  const rungs: ScaleRung[] = [];
  for (const [px, raw] of [...byPx].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const sz = floorSize(raw, market.szDecimals);
    if (!sz || Number(sz) * Number(px) < MIN_ORDER_USD) {
      const need = MIN_ORDER_USD * byPx.size * 1.05;
      throw new Error(`Each order must be at least $${MIN_ORDER_USD}; ${byPx.size} orders need about $${Math.ceil(need)}`);
    }
    rungs.push({ px, sz });
  }

  let crossing = 0;
  if (input.book) {
    const { bid, ask } = input.book;
    crossing = rungs.filter((r) => (input.isBuy ? Number(r.px) >= ask : Number(r.px) <= bid)).length;
  }
  if (crossing > 0) {
    const side = input.isBuy ? "buy" : "sell";
    const where = input.isBuy ? `at or above the best ask (${input.book!.ask})` : `at or below the best bid (${input.book!.bid})`;
    const which = crossing === rungs.length ? `All ${crossing} ${side} orders are` : `${crossing} of ${rungs.length} ${side} orders are`;
    if (input.postOnly) throw new Error(`Post-only would be rejected: ${which} ${where}`);
    warnings.push(`${which} ${where} and fill immediately as taker instead of resting`);
  }

  const totalSize = rungs.reduce((a, r) => a + Number(r.sz), 0);
  const notional = rungs.reduce((a, r) => a + Number(r.sz) * Number(r.px), 0);
  const tif = input.postOnly ? "Alo" : "Gtc";
  return {
    orders: rungs.map((r) => ({
      a: market.assetId,
      b: input.isBuy,
      p: r.px,
      s: r.sz,
      r: market.kind === "perp" && input.reduceOnly,
      t: { limit: { tif } },
    })),
    rungs,
    totalSize,
    notional,
    avgPx: notional / totalSize,
    low,
    high,
    crossing,
    warnings,
  };
}

// Scale Side: a ladder on the passive side of the book, starting `offset`
// away from the quote and spanning `range` further (both fractions, e.g.
// 0.001 = 0.1%). Buys ladder down from the bid, sells up from the ask.
export function scaleSideRange(isBuy: boolean, book: { bid: number; ask: number }, offset: number, range: number) {
  if (!(range > 0)) throw new Error("Range must be greater than zero");
  if (offset < 0) throw new Error("Offset cannot be negative");
  const quote = isBuy ? book.bid : book.ask;
  if (!(quote > 0)) throw new Error("No quote available");
  const dir = isBuy ? -1 : 1;
  return { priceA: quote * (1 + dir * offset), priceB: quote * (1 + dir * (offset + range)) };
}

function clampSkew(skew: number) {
  return Number.isFinite(skew) ? Math.min(1, Math.max(-1, skew)) : 0;
}
