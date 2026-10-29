import type { Market } from "./markets";
import { marketPrice, type OrderSpec } from "./orders";
import { floorSize, MIN_ORDER_USD, toPlain } from "./sizing";

export const MIN_SWARM_LOTS = 2;
export const MAX_SWARM_LOTS = 50;

export interface SwarmInput {
  market: Market;
  isBuy: boolean;
  size: number;
  lots: number;
  // Random lot sizes (each 0.5x to 1.5x of an even lot) instead of equal ones.
  irregular: boolean;
  slippage: number;
  reduceOnly: boolean;
  random?: () => number;
}

// Splits a market order into `lots` slices sent as one batch, each a
// slippage-bounded IOC at the same limit, so they hit the book in parallel.
export function planSwarm(input: SwarmInput): { orders: OrderSpec[]; sizes: string[] } {
  const { market, lots } = input;
  if (!Number.isInteger(lots) || lots < MIN_SWARM_LOTS || lots > MAX_SWARM_LOTS) {
    throw new Error(`Lots must be ${MIN_SWARM_LOTS} to ${MAX_SWARM_LOTS}`);
  }
  if (!(input.size > 0)) throw new Error("Size must be greater than zero");
  const random = input.random ?? Math.random;
  const weights = Array.from({ length: lots }, () => (input.irregular ? 0.5 + random() : 1));
  const total = weights.reduce((a, b) => a + b, 0);

  // Allocate in whole lot-size units so lots sum exactly to the (floored)
  // size; the last lot absorbs the remainder. Float subtraction would leave
  // e.g. 0.24999 and floor a unit away.
  const step = 10 ** market.szDecimals;
  const floored = floorSize(input.size, market.szDecimals);
  if (!floored) throw new Error("Size is below the minimum step");
  const units = Math.round(Number(floored) * step);
  const lotUnits = weights.map((w) => Math.floor((units * w) / total));
  lotUnits[lots - 1] = units - lotUnits.slice(0, -1).reduce((a, b) => a + b, 0);
  if (lotUnits.some((u) => u <= 0)) throw new Error(`Size is too small to split into ${lots} lots`);
  const sizes = lotUnits.map((u) => toPlain(u / step));

  const reference = market.midPx ?? market.markPx;
  const smallest = Math.min(...sizes.map(Number));
  if (smallest * reference < MIN_ORDER_USD) {
    throw new Error(`Each lot must be at least $${MIN_ORDER_USD}; use fewer lots or a larger size`);
  }

  const p = marketPrice(market, input.isBuy, input.slippage);
  return {
    sizes,
    orders: sizes.map((s) => ({
      a: market.assetId,
      b: input.isBuy,
      p,
      s,
      r: market.kind === "perp" && input.reduceOnly,
      t: { limit: { tif: "FrontendMarket" as const } },
    })),
  };
}
