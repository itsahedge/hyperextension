import { ExchangeClient } from "@nktkas/hyperliquid";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import type { Market } from "./markets";
import { buildClose, buildOrder, marketPrice } from "./orders";
import { submitOrders } from "./placement";
import { planScale } from "./scale";
import { planSwarm } from "./swarm";
import { withTpSl } from "./trigger";
import { buildTwap } from "./twap";

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
  openInterest: 1000,
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
  openInterest: null,
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

describe("no builder codes", () => {
  // Captures the exact JSON the SDK would POST to /exchange, after signing.
  function capturingClient() {
    const sent: { endpoint: string; payload: { action: Record<string, unknown> } }[] = [];
    const transport = {
      isTestnet: true,
      async request(endpoint: "info" | "exchange", payload: unknown) {
        sent.push({ endpoint, payload: payload as never });
        return { status: "ok", response: { type: "order", data: { statuses: [{ resting: { oid: 1 } }] } } } as never;
      },
    };
    // Well-known Anvil/Hardhat development key. Never fund it.
    const wallet = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    return { client: new ExchangeClient({ transport, wallet }), sent };
  }

  const entry = () => buildOrder({ market: btc, isBuy: true, size: "0.01", type: "limit", price: "99000" });
  it.each([
    ["market", () => ({ orders: [buildOrder({ market: btc, isBuy: true, size: "0.01", type: "market" })] })],
    ["limit", () => ({ orders: [buildOrder({ market: btc, isBuy: false, size: "1", type: "limit", price: "105000", tif: "Alo" })] })],
    ["spot", () => ({ orders: [buildOrder({ market: hype, isBuy: true, size: "2", type: "market" })] })],
    ["close", () => ({ orders: [buildClose(btc, "-0.25")] })],
    [
      "scale",
      () => ({
        orders: planScale({
          market: btc,
          isBuy: true,
          size: { base: 0.01 },
          priceA: 99_000,
          priceB: 95_000,
          count: 5,
          priceSkew: 0,
          sizeSkew: 0,
          postOnly: true,
          reduceOnly: false,
        }).orders,
      }),
    ],
    [
      "swarm",
      () => ({
        orders: planSwarm({ market: btc, isBuy: true, size: 0.01, lots: 3, irregular: true, slippage: 0.01, reduceOnly: false }).orders,
      }),
    ],
    ["tp/sl", () => withTpSl(btc, entry(), 99_000, { tp: 110_000, sl: 90_000 })],
  ])("%s order payload has no builder field", async (_name, make) => {
    const { client, sent } = capturingClient();
    const { orders, grouping } = make() as { orders: ReturnType<typeof entry>[]; grouping?: "na" | "normalTpsl" };
    await submitOrders(client, orders, grouping);
    expect(sent).toHaveLength(1);
    const { action } = sent[0]!.payload;
    expect(action.type).toBe("order");
    expect(action).not.toHaveProperty("builder");
    expect(JSON.stringify(sent[0]!.payload)).not.toMatch(/"builder"/);
  });

  it("twap payload has no builder field", async () => {
    const { client, sent } = capturingClient();
    await client.twapOrder(buildTwap({ market: btc, isBuy: true, size: "0.01", minutes: 30, randomize: false, reduceOnly: false })).catch(() => {});
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0]!.payload)).not.toMatch(/"builder"/);
  });

  // Guards against reintroducing builder approvals, builder-tagged orders, or
  // referral codes anywhere in the app source.
  it("app source never references builder fees or referrals", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
      (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f),
    );
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((f) =>
      /approveBuilderFee|maxBuilderFee|approvedBuilders|\bbuilder\s*:|setReferrer|registerReferrer/.test(
        readFileSync(join(root, f), "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
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
