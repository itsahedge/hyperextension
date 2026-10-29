import type { TwapOrderParameters } from "@nktkas/hyperliquid/api/exchange";
import type { Market } from "./markets";
import { buildOrder, type OrderSpec } from "./orders";
import type { Grouping } from "./placement";
import { planScale, scaleSideRange } from "./scale";
import { floorSize, parsePositive } from "./sizing";
import { planSwarm } from "./swarm";
import { buildTrigger, withTpSl } from "./trigger";
import { buildTwap } from "./twap";

export type OrderTypeId = "limit" | "limitStop" | "scale" | "scaleSide" | "market" | "marketStop" | "swarm" | "twap";

export const ORDER_TYPES: { group: "Limit" | "Market"; id: OrderTypeId; label: string; perpOnly?: boolean }[] = [
  { group: "Limit", id: "limit", label: "Order" },
  { group: "Limit", id: "limitStop", label: "Stop", perpOnly: true },
  { group: "Limit", id: "scale", label: "Scale" },
  { group: "Limit", id: "scaleSide", label: "Scale Side" },
  { group: "Market", id: "market", label: "Order" },
  { group: "Market", id: "marketStop", label: "Stop", perpOnly: true },
  { group: "Market", id: "swarm", label: "Swarm" },
  { group: "Market", id: "twap", label: "TWAP", perpOnly: true },
];

// TP/SL attaches to single entries only; Hyperliquid's parent/child grouping
// takes one parent order.
export const TPSL_TYPES: OrderTypeId[] = ["limit", "market"];
export const POST_TYPES: OrderTypeId[] = ["limit", "scale", "scaleSide"];

export interface PanelState {
  type: OrderTypeId;
  // Base units; the USD input converts through referencePrice.
  size: string;
  price: string;
  trigger: string;
  stopLimit: string;
  scaleA: string;
  scaleB: string;
  count: number;
  priceSkew: number;
  sizeSkew: number;
  // Percent strings, e.g. "0.1" = 0.1%.
  sideOffset: string;
  sideRange: string;
  lots: number;
  irregular: boolean;
  minutes: number;
  randomize: boolean;
  post: boolean;
  reduce: boolean;
  tpsl: boolean;
  tp: string;
  sl: string;
}

export const initialPanel: PanelState = {
  type: "limit",
  size: "",
  price: "",
  trigger: "",
  stopLimit: "",
  scaleA: "",
  scaleB: "",
  count: 10,
  priceSkew: 0,
  sizeSkew: 0,
  sideOffset: "0",
  sideRange: "1",
  lots: 5,
  irregular: false,
  minutes: 30,
  randomize: false,
  post: false,
  reduce: false,
  tpsl: false,
  tp: "",
  sl: "",
};

export interface EntryContext {
  market: Market;
  book?: { bid: number; ask: number };
  slippage: number;
}

export interface EntryPreview {
  size: number;
  // Single-price entries; null for ladders and TWAP.
  price: number | null;
  avgPx: number | null;
  orderCount: number;
  notional: number;
  warnings: string[];
}

export type EntryPlan =
  | { kind: "orders"; orders: OrderSpec[]; grouping: Grouping; preview: EntryPreview }
  | { kind: "twap"; params: TwapOrderParameters; preview: EntryPreview };

const mid = (m: Market) => m.midPx ?? m.markPx;

// Price used to convert between base and USD size for the current inputs.
export function referencePrice(s: PanelState, { market, book }: EntryContext): number {
  const pick = (...values: string[]) => values.map(parsePositive).find((v) => v !== null) ?? mid(market);
  switch (s.type) {
    case "limit":
      return pick(s.price);
    case "limitStop":
      return pick(s.stopLimit, s.trigger);
    case "marketStop":
      return pick(s.trigger);
    case "scale": {
      const a = parsePositive(s.scaleA);
      const b = parsePositive(s.scaleB);
      return a && b ? (a + b) / 2 : mid(market);
    }
    case "scaleSide":
      return book && book.bid > 0 ? (book.bid + book.ask) / 2 : mid(market);
    default:
      return mid(market);
  }
}

function single(order: OrderSpec, price: number | null, notionalPx: number): EntryPreview {
  const size = Number(order.s);
  return { size, price, avgPx: null, orderCount: 1, notional: size * notionalPx, warnings: [] };
}

function lotSize(input: string, market: Market): string {
  const n = parsePositive(input);
  if (!n) throw new Error("Size must be greater than zero");
  const size = floorSize(n, market.szDecimals);
  if (!size) throw new Error(`Size is below the minimum step (${market.szDecimals} decimals)`);
  return size;
}

function targets(s: PanelState) {
  const tp = parsePositive(s.tp) ?? undefined;
  const sl = parsePositive(s.sl) ?? undefined;
  return { tp, sl };
}

export function planEntry(s: PanelState, ctx: EntryContext, isBuy: boolean): EntryPlan {
  const { market } = ctx;
  if (ORDER_TYPES.find((t) => t.id === s.type)?.perpOnly && market.kind !== "perp") {
    throw new Error("This order type is available on perps only");
  }
  const reduceOnly = market.kind === "perp" && s.reduce;
  const attach = (entry: OrderSpec, entryPx: number, preview: EntryPreview): EntryPlan => {
    if (!s.tpsl || !TPSL_TYPES.includes(s.type)) return { kind: "orders", orders: [entry], grouping: "na", preview };
    const { orders, grouping } = withTpSl(market, entry, entryPx, targets(s));
    return { kind: "orders", orders, grouping, preview };
  };

  switch (s.type) {
    case "limit": {
      const order = buildOrder({ market, isBuy, size: s.size, type: "limit", price: s.price, tif: s.post ? "Alo" : "Gtc", reduceOnly });
      return attach(order, Number(order.p), single(order, Number(order.p), Number(order.p)));
    }
    case "market": {
      const order = buildOrder({ market, isBuy, size: s.size, type: "market", reduceOnly, slippage: ctx.slippage });
      return attach(order, mid(market), single(order, mid(market), mid(market)));
    }
    case "limitStop":
    case "marketStop": {
      const order = buildTrigger({
        market,
        isBuy,
        size: lotSize(s.size, market),
        triggerPx: parsePositive(s.trigger) ?? 0,
        limitPx: s.type === "limitStop" ? (parsePositive(s.stopLimit) ?? 0) : undefined,
        reduceOnly,
      });
      const px = Number("trigger" in order.t ? order.t.trigger.triggerPx : order.p);
      return { kind: "orders", orders: [order], grouping: "na", preview: single(order, px, px) };
    }
    case "scale":
    case "scaleSide": {
      const size = parsePositive(s.size);
      if (!size) throw new Error("Size must be greater than zero");
      let priceA = parsePositive(s.scaleA) ?? 0;
      let priceB = parsePositive(s.scaleB) ?? 0;
      if (s.type === "scaleSide") {
        if (!ctx.book || !(ctx.book.bid > 0)) throw new Error("Waiting for the order book");
        const offset = Number(s.sideOffset);
        const range = Number(s.sideRange);
        if (!Number.isFinite(offset) || !Number.isFinite(range)) throw new Error("Enter offset and range");
        ({ priceA, priceB } = scaleSideRange(isBuy, ctx.book, offset / 100, range / 100));
      }
      const plan = planScale({
        market,
        isBuy,
        size: { base: size },
        priceA,
        priceB,
        count: s.count,
        priceSkew: s.priceSkew,
        sizeSkew: s.sizeSkew,
        postOnly: s.post,
        reduceOnly,
        book: ctx.book && ctx.book.bid > 0 ? ctx.book : undefined,
      });
      return {
        kind: "orders",
        orders: plan.orders,
        grouping: "na",
        preview: {
          size: plan.totalSize,
          price: null,
          avgPx: plan.avgPx,
          orderCount: plan.orders.length,
          notional: plan.notional,
          warnings: plan.warnings,
        },
      };
    }
    case "swarm": {
      const size = parsePositive(s.size);
      if (!size) throw new Error("Size must be greater than zero");
      const { orders } = planSwarm({ market, isBuy, size, lots: s.lots, irregular: s.irregular, slippage: ctx.slippage, reduceOnly });
      const total = orders.reduce((a, o) => a + Number(o.s), 0);
      return {
        kind: "orders",
        orders,
        grouping: "na",
        preview: { size: total, price: mid(market), avgPx: null, orderCount: orders.length, notional: total * mid(market), warnings: [] },
      };
    }
    case "twap": {
      const size = lotSize(s.size, market);
      const params = buildTwap({ market, isBuy, size, minutes: s.minutes, randomize: s.randomize, reduceOnly });
      return {
        kind: "twap",
        params,
        preview: { size: Number(size), price: null, avgPx: null, orderCount: 1, notional: Number(size) * mid(market), warnings: [] },
      };
    }
  }
}

export interface Balances {
  // Perps: Hyperliquid's own max trade size per side (activeAssetData).
  perpMax?: { buy: number; sell: number };
  // Signed perp position size for this coin (0 when flat).
  position: number;
  // Spot: free quote and base balances.
  spotQuote?: number;
  spotBase?: number;
}

// Largest size per side, for the slider and MAX. Reduce-only can never
// exceed the open position.
export function maxSizes(s: PanelState, ctx: EntryContext, bal: Balances): { buy: number; sell: number } {
  if (ctx.market.kind === "perp") {
    if (s.reduce) return { buy: bal.position < 0 ? -bal.position : 0, sell: bal.position > 0 ? bal.position : 0 };
    return bal.perpMax ?? { buy: 0, sell: 0 };
  }
  const px = referencePrice(s, ctx);
  return { buy: px > 0 ? (bal.spotQuote ?? 0) / px : 0, sell: bal.spotBase ?? 0 };
}
