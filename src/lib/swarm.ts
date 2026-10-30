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
  // 16 hex chars shared by every lot's cloid; random when omitted.
  swarmId?: string;
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
  const swarmId = input.swarmId ?? newSwarmId();
  return {
    sizes,
    orders: sizes.map((s, i) => ({
      a: market.assetId,
      b: input.isBuy,
      p,
      s,
      r: market.kind === "perp" && input.reduceOnly,
      t: { limit: { tif: "FrontendMarket" as const } },
      c: swarmCloid(swarmId, i + 1, sizes.length),
    })),
  };
}

// Swarm lots carry a client order id (cloid, 128 bits) that Hyperliquid
// returns on fills and order history, so lots are regrouped from any device:
//
//   0x 5357524d  <swarm id, 8 bytes>  <lot, 2 bytes>  <lot count, 2 bytes>
//      "SWRM"     shared by all lots   1-based
const SWARM_TAG = "5357524d";
const CLOID = /^0x5357524d([0-9a-f]{16})([0-9a-f]{4})([0-9a-f]{4})$/;

export function newSwarmId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function swarmCloid(swarmId: string, lot: number, lots: number): `0x${string}` {
  if (!/^[0-9a-f]{16}$/.test(swarmId)) throw new Error("Swarm id must be 16 lowercase hex characters");
  const u16 = (n: number) => n.toString(16).padStart(4, "0");
  return `0x${SWARM_TAG}${swarmId}${u16(lot)}${u16(lots)}`;
}

export function parseSwarmCloid(cloid: string | null | undefined): { id: string; lot: number; lots: number } | null {
  const m = cloid ? CLOID.exec(cloid) : null;
  return m ? { id: m[1]!, lot: parseInt(m[2]!, 16), lots: parseInt(m[3]!, 16) } : null;
}

export type SwarmItem<T> =
  | { kind: "row"; row: T }
  | { kind: "swarm"; id: string; lotCount: number; lots: { lot: number; rows: T[] }[]; rows: T[] };

// Collapses the rows of each swarm (fills or orders) into one item placed
// where its first row was; other rows pass through in order. Lots are sorted
// by lot number and keep every row (a lot can fill against several orders).
export function groupBySwarm<T>(rows: T[], cloidOf: (row: T) => string | null | undefined): SwarmItem<T>[] {
  const items: SwarmItem<T>[] = [];
  const swarms = new Map<string, Extract<SwarmItem<T>, { kind: "swarm" }>>();
  for (const row of rows) {
    const tag = parseSwarmCloid(cloidOf(row));
    if (!tag) {
      items.push({ kind: "row", row });
      continue;
    }
    let swarm = swarms.get(tag.id);
    if (!swarm) {
      swarm = { kind: "swarm", id: tag.id, lotCount: tag.lots, lots: [], rows: [] };
      swarms.set(tag.id, swarm);
      items.push(swarm);
    }
    swarm.rows.push(row);
    const lot = swarm.lots.find((l) => l.lot === tag.lot);
    if (lot) lot.rows.push(row);
    else swarm.lots.push({ lot: tag.lot, rows: [row] });
  }
  for (const s of swarms.values()) s.lots.sort((a, b) => a.lot - b.lot);
  return items;
}
