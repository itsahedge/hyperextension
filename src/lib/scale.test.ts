import { describe, expect, it } from "vitest";
import type { Market } from "./markets";
import { MAX_SCALE_ORDERS, planScale, scalePositions, scaleSideRange, scaleWeights, type ScaleInput } from "./scale";

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

const base = (over: Partial<ScaleInput> = {}): ScaleInput => ({
  market: eth,
  isBuy: true,
  size: { base: 1 },
  priceA: 2000,
  priceB: 1900,
  count: 5,
  priceSkew: 0,
  sizeSkew: 0,
  postOnly: false,
  reduceOnly: false,
  ...over,
});

describe("scalePositions / scaleWeights", () => {
  it("is evenly spaced and evenly weighted at zero skew", () => {
    expect(scalePositions(5, 0)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(scaleWeights([0, 0.5, 1], 0)).toEqual([1, 1, 1]);
  });

  it("positive price skew packs rungs toward the high end; negative toward the low", () => {
    const up = scalePositions(5, 1);
    const down = scalePositions(5, -1);
    expect(up[1]!).toBeGreaterThan(0.25);
    expect(down[1]!).toBeLessThan(0.25);
    expect(up[0]).toBe(0);
    expect(up[4]).toBe(1);
  });

  it("size skew caps the heavy/light ratio at 4x and favors the skewed end", () => {
    const w = scaleWeights([0, 1], 1);
    expect(w[1]! / w[0]!).toBeCloseTo(4);
    const wNeg = scaleWeights([0, 1], -1);
    expect(wNeg[0]! / wNeg[1]!).toBeCloseTo(4);
  });

  it("clamps out-of-range skews", () => {
    expect(scalePositions(3, 5)).toEqual(scalePositions(3, 1));
  });
});

describe("planScale", () => {
  it("lays an even ladder, ascending, prices in either order", () => {
    const plan = planScale(base({ priceA: 1900, priceB: 2000 }));
    expect(plan.rungs).toEqual([
      { px: "1900", sz: "0.2" },
      { px: "1925", sz: "0.2" },
      { px: "1950", sz: "0.2" },
      { px: "1975", sz: "0.2" },
      { px: "2000", sz: "0.2" },
    ]);
    expect(plan.totalSize).toBeCloseTo(1);
    expect(plan.avgPx).toBeCloseTo(1950);
    expect(plan.orders.every((o) => o.b && !o.r && "limit" in o.t && o.t.limit.tif === "Gtc")).toBe(true);
    expect(planScale(base()).rungs).toEqual(plan.rungs);
  });

  it("sizes from USD at the size-weighted average price", () => {
    const plan = planScale(base({ size: { usd: 1950 } }));
    expect(plan.totalSize).toBeCloseTo(1, 3);
  });

  it("size skew moves size toward the skewed end", () => {
    const plan = planScale(base({ sizeSkew: 1 }));
    expect(Number(plan.rungs[4]!.sz)).toBeGreaterThan(Number(plan.rungs[0]!.sz));
    expect(plan.avgPx).toBeGreaterThan(1950);
  });

  it("merges rungs that round to the same tick and warns", () => {
    // ETH perp prices allow 5 significant figures: 2000.0x collapses.
    const plan = planScale(base({ priceA: 2000, priceB: 2000.04, count: 5, size: { base: 1 } }));
    expect(plan.rungs.length).toBeLessThan(5);
    expect(plan.warnings.join()).toMatch(/duplicate price/);
    expect(plan.totalSize).toBeCloseTo(1, 3);
  });

  it("rejects rungs under the $10 minimum with the total needed", () => {
    expect(() => planScale(base({ size: { base: 0.02 } }))).toThrow(/at least \$10; 5 orders need about \$53/);
  });

  it("flags crossing rungs, and refuses post-only that would cross", () => {
    const book = { bid: 1949, ask: 1950 };
    const plan = planScale(base({ book }));
    expect(plan.crossing).toBe(3); // 1950, 1975, 2000 are at/through the ask
    expect(plan.warnings.join()).toMatch(/cross the book/);
    expect(() => planScale(base({ book, postOnly: true }))).toThrow(/Post-only would be rejected: 3/);
  });

  it("uses ALO for post-only and only marks perps reduce-only", () => {
    const post = planScale(base({ postOnly: true, reduceOnly: true }));
    expect(post.orders.every((o) => "limit" in o.t && o.t.limit.tif === "Alo" && o.r)).toBe(true);
    const spot = planScale(base({ market: { ...eth, kind: "spot", assetId: 10_107 }, reduceOnly: true }));
    expect(spot.orders.every((o) => !o.r && o.a === 10_107)).toBe(true);
  });

  it("validates count and prices", () => {
    expect(() => planScale(base({ count: 1 }))).toThrow(/2 to 50/);
    expect(() => planScale(base({ count: MAX_SCALE_ORDERS + 1 }))).toThrow(/2 to 50/);
    expect(() => planScale(base({ priceB: 2000 }))).toThrow(/same/);
    expect(() => planScale(base({ priceA: 0 }))).toThrow(/both prices/);
  });
});

describe("scaleSideRange", () => {
  const book = { bid: 1000, ask: 1001 };
  it("ladders buys down from the bid and sells up from the ask", () => {
    const buy = scaleSideRange(true, book, 0.001, 0.01);
    expect(buy.priceA).toBeCloseTo(999);
    expect(buy.priceB).toBeCloseTo(989);
    const sell = scaleSideRange(false, book, 0, 0.01);
    expect(sell.priceA).toBeCloseTo(1001);
    expect(sell.priceB).toBeCloseTo(1011.01);
  });

  it("validates inputs", () => {
    expect(() => scaleSideRange(true, book, 0, 0)).toThrow(/Range/);
    expect(() => scaleSideRange(true, book, -0.1, 0.01)).toThrow(/negative/);
    expect(() => scaleSideRange(true, { bid: 0, ask: 0 }, 0, 0.01)).toThrow(/quote/);
  });
});
