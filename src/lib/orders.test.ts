import { describe, expect, it } from "vitest";
import type { Market } from "./markets";
import { buildClose, buildOrder, marketPrice } from "./orders";

const btc: Market = {
  kind: "perp",
  name: "BTC",
  coin: "BTC",
  assetId: 0,
  szDecimals: 5,
  maxLeverage: 40,
  markPx: 100_000,
  midPx: 100_000,
  prevDayPx: 99_000,
  dayNtlVlm: 1,
  funding: 0.0001,
};

const hype: Market = {
  ...btc,
  kind: "spot",
  name: "HYPE/USDC",
  coin: "@107",
  assetId: 10_107,
  szDecimals: 2,
  maxLeverage: null,
  markPx: 40.1234,
  midPx: 40.1234,
  funding: null,
};

describe("marketPrice", () => {
  it("bounds buys above and sells below the mid", () => {
    expect(Number(marketPrice(btc, true, 0.01))).toBe(101_000);
    expect(Number(marketPrice(btc, false, 0.01))).toBe(99_000);
  });

  it("falls back to mark price when there is no mid", () => {
    expect(Number(marketPrice({ ...btc, midPx: null, markPx: 50_000 }, true, 0.01))).toBe(50_500);
  });

  it("formats with spot precision rules", () => {
    // 40.1234 * 1.01 = 40.524634 -> 5 significant figures, truncated.
    expect(marketPrice(hype, true, 0.01)).toBe("40.524");
  });

  it("rejects out-of-range slippage and missing prices", () => {
    expect(() => marketPrice(btc, true, 0)).toThrow();
    expect(() => marketPrice(btc, true, 1)).toThrow();
    expect(() => marketPrice({ ...btc, midPx: null, markPx: 0 }, true, 0.01)).toThrow(/No price/);
  });
});

describe("buildOrder", () => {
  it("builds a market order as FrontendMarket with a slippage-bounded price", () => {
    expect(buildOrder({ market: btc, isBuy: true, size: "0.0012345678", type: "market" })).toEqual({
      a: 0,
      b: true,
      p: "101000",
      s: "0.00123",
      r: false,
      t: { limit: { tif: "FrontendMarket" } },
    });
  });

  it("builds a limit order with the chosen TIF and reduce-only flag", () => {
    expect(
      buildOrder({ market: btc, isBuy: false, size: "1", type: "limit", price: "105123.9", tif: "Alo", reduceOnly: true }),
    ).toEqual({ a: 0, b: false, p: "105120", s: "1", r: true, t: { limit: { tif: "Alo" } } });
  });

  it("never marks spot orders reduce-only", () => {
    expect(buildOrder({ market: hype, isBuy: true, size: "1", type: "limit", price: "40", reduceOnly: true }).r).toBe(false);
  });

  it("uses the spot asset id", () => {
    expect(buildOrder({ market: hype, isBuy: true, size: "1", type: "market" }).a).toBe(10_107);
  });

  it("rejects bad sizes and prices", () => {
    expect(() => buildOrder({ market: btc, isBuy: true, size: "0", type: "market" })).toThrow();
    expect(() => buildOrder({ market: btc, isBuy: true, size: "abc", type: "market" })).toThrow();
    expect(() => buildOrder({ market: hype, isBuy: true, size: "0.001", type: "market" })).toThrow();
    expect(() => buildOrder({ market: btc, isBuy: true, size: "1", type: "limit", price: "" })).toThrow(/Price/);
  });
});

describe("buildClose", () => {
  it("closes a long with a reduce-only market sell", () => {
    const order = buildClose(btc, "0.5");
    expect(order).toMatchObject({ b: false, s: "0.5", r: true, p: "99000" });
  });

  it("closes a short with a reduce-only market buy", () => {
    expect(buildClose(btc, "-0.25")).toMatchObject({ b: true, s: "0.25", r: true });
  });

  it("rejects a flat position", () => {
    expect(() => buildClose(btc, "0.0")).toThrow(/No position/);
  });
});
