import { describe, expect, it } from "vitest";
import { initialPanel, maxSizes, planEntry, referencePrice, type EntryContext, type PanelState } from "./entry";
import type { Market } from "./markets";

const eth: Market = {
  kind: "perp",
  name: "ETH",
  coin: "ETH",
  assetId: 1,
  szDecimals: 4,
  maxLeverage: 25,
  markPx: 2000,
  midPx: 2000,
  prevDayPx: 2000,
  dayNtlVlm: 1,
  funding: 0,
};
const hype: Market = { ...eth, kind: "spot", name: "HYPE/USDC", coin: "@107", assetId: 10_107, szDecimals: 2, midPx: 40, markPx: 40 };
const ctx: EntryContext = { market: eth, book: { bid: 1999, ask: 2001 }, slippage: 0.01 };
const panel = (over: Partial<PanelState>): PanelState => ({ ...initialPanel, ...over });

describe("planEntry", () => {
  it("limit: single order with post-only and reduce flags", () => {
    const plan = planEntry(panel({ type: "limit", size: "0.5", price: "1990", post: true, reduce: true }), ctx, true);
    expect(plan.kind).toBe("orders");
    if (plan.kind !== "orders") return;
    expect(plan.grouping).toBe("na");
    expect(plan.orders).toEqual([{ a: 1, b: true, p: "1990", s: "0.5", r: true, t: { limit: { tif: "Alo" } } }]);
    expect(plan.preview).toMatchObject({ size: 0.5, price: 1990, orderCount: 1, notional: 995 });
  });

  it("limit + TP/SL: groups the entry with its children", () => {
    const plan = planEntry(panel({ type: "limit", size: "0.5", price: "1990", tpsl: true, tp: "2200", sl: "1900" }), ctx, true);
    if (plan.kind !== "orders") throw new Error("expected orders");
    expect(plan.grouping).toBe("normalTpsl");
    expect(plan.orders).toHaveLength(3);
  });

  it("TP/SL is ignored for types it does not apply to", () => {
    const plan = planEntry(panel({ type: "swarm", size: "1", lots: 4, tpsl: true, tp: "2200" }), ctx, true);
    if (plan.kind !== "orders") throw new Error("expected orders");
    expect(plan.grouping).toBe("na");
    expect(plan.orders).toHaveLength(4);
  });

  it("market: slippage-bounded at the mid", () => {
    const plan = planEntry(panel({ type: "market", size: "1" }), { ...ctx, slippage: 0.02 }, false);
    if (plan.kind !== "orders") throw new Error("expected orders");
    expect(plan.orders[0]).toMatchObject({ b: false, p: "1960", s: "1" });
  });

  it("stops: market and limit triggers, floored size", () => {
    const m = planEntry(panel({ type: "marketStop", size: "0.123456", trigger: "2100" }), ctx, true);
    if (m.kind !== "orders") throw new Error("expected orders");
    expect(m.orders[0]).toMatchObject({ s: "0.1234", t: { trigger: { isMarket: true, triggerPx: "2100", tpsl: "sl" } } });
    const l = planEntry(panel({ type: "limitStop", size: "1", trigger: "1900", stopLimit: "1895" }), ctx, false);
    if (l.kind !== "orders") throw new Error("expected orders");
    expect(l.orders[0]).toMatchObject({ p: "1895", t: { trigger: { isMarket: false, triggerPx: "1900" } } });
    expect(() => planEntry(panel({ type: "limitStop", size: "1", trigger: "1900" }), ctx, false)).toThrow(/limit price/);
  });

  it("scale: ladder preview with average price", () => {
    const plan = planEntry(panel({ type: "scale", size: "1", scaleA: "1900", scaleB: "1980", count: 5 }), ctx, true);
    expect(plan.preview).toMatchObject({ orderCount: 5, price: null });
    expect(plan.preview.avgPx).toBeCloseTo(1940);
  });

  it("scale side: anchors to the bid for buys and the ask for sells", () => {
    const buy = planEntry(panel({ type: "scaleSide", size: "1", sideOffset: "0.1", sideRange: "1", count: 5 }), ctx, true);
    if (buy.kind !== "orders") throw new Error("expected orders");
    expect(Math.max(...buy.orders.map((o) => Number(o.p)))).toBeLessThan(1999);
    const sell = planEntry(panel({ type: "scaleSide", size: "1", sideOffset: "0.1", sideRange: "1", count: 5 }), ctx, false);
    if (sell.kind !== "orders") throw new Error("expected orders");
    expect(Math.min(...sell.orders.map((o) => Number(o.p)))).toBeGreaterThan(2001);
    expect(() => planEntry(panel({ type: "scaleSide", size: "1" }), { ...ctx, book: undefined }, true)).toThrow(/order book/);
  });

  it("twap: native TWAP params", () => {
    const plan = planEntry(panel({ type: "twap", size: "1", minutes: 60, randomize: true }), ctx, true);
    expect(plan).toMatchObject({ kind: "twap", params: { twap: { a: 1, b: true, s: "1", m: 60, t: true, r: false } } });
  });

  it("refuses perp-only types on spot and never marks spot reduce-only", () => {
    const spotCtx = { ...ctx, market: hype };
    expect(() => planEntry(panel({ type: "twap", size: "10" }), spotCtx, true)).toThrow(/perps only/);
    expect(() => planEntry(panel({ type: "marketStop", size: "10", trigger: "45" }), spotCtx, true)).toThrow(/perps only/);
    const plan = planEntry(panel({ type: "limit", size: "1", price: "40", reduce: true }), spotCtx, true);
    if (plan.kind !== "orders") throw new Error("expected orders");
    expect(plan.orders[0]!.r).toBe(false);
  });
});

describe("referencePrice", () => {
  it("follows the price that will actually be used", () => {
    expect(referencePrice(panel({ type: "limit", price: "1990" }), ctx)).toBe(1990);
    expect(referencePrice(panel({ type: "limit" }), ctx)).toBe(2000);
    expect(referencePrice(panel({ type: "limitStop", trigger: "2100" }), ctx)).toBe(2100);
    expect(referencePrice(panel({ type: "limitStop", trigger: "2100", stopLimit: "2110" }), ctx)).toBe(2110);
    expect(referencePrice(panel({ type: "scale", scaleA: "1900", scaleB: "2100" }), ctx)).toBe(2000);
    expect(referencePrice(panel({ type: "scaleSide" }), ctx)).toBe(2000);
  });
});

describe("maxSizes", () => {
  it("perps use Hyperliquid's max per side, or the position when reducing", () => {
    expect(maxSizes(panel({}), ctx, { perpMax: { buy: 5, sell: 7 }, position: 1 })).toEqual({ buy: 5, sell: 7 });
    expect(maxSizes(panel({ reduce: true }), ctx, { perpMax: { buy: 5, sell: 7 }, position: 1 })).toEqual({ buy: 0, sell: 1 });
    expect(maxSizes(panel({ reduce: true }), ctx, { position: -2 })).toEqual({ buy: 2, sell: 0 });
  });

  it("spot buys are bounded by free quote at the reference price, sells by free base", () => {
    expect(maxSizes(panel({ type: "limit", price: "50" }), { ...ctx, market: hype }, { position: 0, spotQuote: 1000, spotBase: 3 })).toEqual({
      buy: 20,
      sell: 3,
    });
  });
});
