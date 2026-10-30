import { describe, expect, it } from "vitest";
import { fillableWithin, type BookLevel } from "./liquidity";

const asks: BookLevel[] = [
  { px: 0.5112, sz: 5000 },
  { px: 0.5125, sz: 8000 },
  { px: 0.5133, sz: 5165.74 },
  { px: 0.514, sz: 40000 },
];
const bids: BookLevel[] = [
  { px: 0.5108, sz: 3000 },
  { px: 0.51, sz: 2000 },
  { px: 0.508, sz: 9000 },
];

describe("fillableWithin", () => {
  it("fills a buy from the asks up to the price limit", () => {
    // The 2026-10-30 order: 19,577.32 KNTQ with a 0.51334 limit.
    const r = fillableWithin(asks, true, 0.51334, 19577.32);
    expect(r.size).toBeCloseTo(18165.74, 6);
    expect(r.notional).toBeCloseTo(5000 * 0.5112 + 8000 * 0.5125 + 5165.74 * 0.5133, 6);
    expect(r.complete).toBe(false);
    expect(r.limitedByVisibleBook).toBe(false);
  });

  it("is complete when the book within the limit covers the size", () => {
    expect(fillableWithin(asks, true, 0.51334, 10000)).toMatchObject({ size: 10000, complete: true });
  });

  it("fills a sell from the bids down to the price limit", () => {
    const r = fillableWithin(bids, false, 0.5095, 9000);
    expect(r).toMatchObject({ size: 5000, complete: false });
  });

  it("flags when every visible level is inside the limit (more may exist deeper)", () => {
    expect(fillableWithin(asks, true, 1, 100_000)).toMatchObject({ size: 58165.74, complete: false, limitedByVisibleBook: true });
  });

  it("handles an empty side", () => {
    expect(fillableWithin([], true, 1, 5)).toMatchObject({ size: 0, notional: 0, complete: false, limitedByVisibleBook: true });
  });
});
