import { ExchangeClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import type { Market } from "./markets";
import { describeSummary, submitOrders, summarizeStatuses } from "./placement";
import { planSwarm } from "./swarm";
import { buildTrigger, triggerKind, withTpSl } from "./trigger";
import { buildTwap, TWAP_MAX_MINUTES } from "./twap";

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
const spot: Market = { ...eth, kind: "spot", name: "HYPE/USDC", coin: "@107", assetId: 10_107, szDecimals: 2 };

describe("planSwarm", () => {
  it("splits evenly into same-priced IOC lots that sum to the size", () => {
    const { orders, sizes } = planSwarm({ market: eth, isBuy: true, size: 1, lots: 4, irregular: false, slippage: 0.01, reduceOnly: false });
    expect(sizes).toEqual(["0.25", "0.25", "0.25", "0.25"]);
    expect(new Set(orders.map((o) => o.p))).toEqual(new Set(["2020"]));
    expect(orders.every((o) => "limit" in o.t && o.t.limit.tif === "FrontendMarket")).toBe(true);
  });

  it("irregular lots vary but still sum exactly to the size", () => {
    const seq = [0, 1, 0.5, 0.25];
    let i = 0;
    const { sizes } = planSwarm({
      market: eth,
      isBuy: false,
      size: 1,
      lots: 4,
      irregular: true,
      slippage: 0.01,
      reduceOnly: true,
      random: () => seq[i++]!,
    });
    expect(new Set(sizes).size).toBeGreaterThan(1);
    // Exact in lot units, not approximately.
    expect(sizes.reduce((a, s) => a + Math.round(Number(s) * 1e4), 0)).toBe(1e4);
    expect(sizes.every((s) => /^\d+(\.\d{1,4})?$/.test(s))).toBe(true);
  });

  it("enforces lot count and the $10 per-lot minimum", () => {
    const base = { market: eth, isBuy: true, irregular: false, slippage: 0.01, reduceOnly: false };
    expect(() => planSwarm({ ...base, size: 1, lots: 1 })).toThrow(/2 to 50/);
    expect(() => planSwarm({ ...base, size: 0.01, lots: 5 })).toThrow(/at least \$10/);
  });
});

describe("triggers", () => {
  it("classifies stop vs take from the trigger's side of the mid", () => {
    expect(triggerKind(true, 2100, 2000)).toBe("sl"); // buy stop above
    expect(triggerKind(true, 1900, 2000)).toBe("tp"); // buy take below
    expect(triggerKind(false, 1900, 2000)).toBe("sl"); // sell stop below
    expect(triggerKind(false, 2100, 2000)).toBe("tp");
  });

  it("stop-market carries a 10% adverse limit; stop-limit uses the given limit", () => {
    const mkt = buildTrigger({ market: eth, isBuy: true, size: "0.5", triggerPx: 2100, reduceOnly: false });
    expect(mkt).toMatchObject({ b: true, p: "2310", s: "0.5", t: { trigger: { isMarket: true, triggerPx: "2100", tpsl: "sl" } } });
    const lim = buildTrigger({ market: eth, isBuy: false, size: "0.5", triggerPx: 1900, limitPx: 1890, reduceOnly: true });
    expect(lim).toMatchObject({ b: false, p: "1890", r: true, t: { trigger: { isMarket: false, triggerPx: "1900", tpsl: "sl" } } });
  });

  it("rejects spot and missing prices", () => {
    expect(() => buildTrigger({ market: spot, isBuy: true, size: "1", triggerPx: 2100, reduceOnly: false })).toThrow(/perps only/);
    expect(() => buildTrigger({ market: eth, isBuy: true, size: "1", triggerPx: 0, reduceOnly: false })).toThrow(/trigger/);
    expect(() => buildTrigger({ market: eth, isBuy: true, size: "1", triggerPx: 2000, reduceOnly: false })).toThrow(/equals/);
  });

  it("attaches reduce-only opposite-side TP/SL children sized to the entry", () => {
    const entry = { a: 1, b: true, p: "2000", s: "0.5", r: false, t: { limit: { tif: "Gtc" as const } } };
    const { orders, grouping } = withTpSl(eth, entry, 2000, { tp: 2200, sl: 1900 });
    expect(grouping).toBe("normalTpsl");
    expect(orders).toHaveLength(3);
    expect(orders[1]).toMatchObject({ b: false, s: "0.5", r: true, p: "1980", t: { trigger: { triggerPx: "2200", tpsl: "tp", isMarket: true } } });
    expect(orders[2]).toMatchObject({ b: false, s: "0.5", r: true, p: "1710", t: { trigger: { triggerPx: "1900", tpsl: "sl" } } });
  });

  it("validates TP/SL direction relative to the entry", () => {
    const long = { a: 1, b: true, p: "2000", s: "0.5", r: false, t: { limit: { tif: "Gtc" as const } } };
    expect(() => withTpSl(eth, long, 2000, { tp: 1900 })).toThrow(/above/);
    expect(() => withTpSl(eth, long, 2000, { sl: 2100 })).toThrow(/below/);
    expect(() => withTpSl(eth, { ...long, b: false }, 2000, { tp: 2100 })).toThrow(/below/);
    expect(() => withTpSl(eth, long, 2000, {})).toThrow(/Set a/);
  });
});

describe("buildTwap", () => {
  it("builds the native TWAP action", () => {
    expect(buildTwap({ market: eth, isBuy: true, size: "1", minutes: 30, randomize: true, reduceOnly: false })).toEqual({
      twap: { a: 1, b: true, s: "1", r: false, m: 30, t: true },
    });
  });

  it("enforces duration, $100 minimum, and perps only", () => {
    const base = { market: eth, isBuy: true, size: "1", randomize: false, reduceOnly: false };
    expect(() => buildTwap({ ...base, minutes: 4 })).toThrow(/5 to 1440/);
    expect(() => buildTwap({ ...base, minutes: TWAP_MAX_MINUTES + 1 })).toThrow(/5 to 1440/);
    expect(() => buildTwap({ ...base, minutes: 10, size: "0.01" })).toThrow(/\$100/);
    expect(() => buildTwap({ ...base, market: spot, minutes: 10 })).toThrow(/perps only/);
  });
});

describe("placement", () => {
  // Well-known Anvil/Hardhat development key. Never fund it.
  const wallet = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const clientReturning = (response: unknown) => {
    const sent: unknown[] = [];
    const transport = {
      isTestnet: true,
      async request(_e: "info" | "exchange", payload: unknown) {
        sent.push(payload);
        return response as never;
      },
    };
    return { client: new ExchangeClient({ transport, wallet }), sent };
  };
  const order = { a: 1, b: true, p: "2000", s: "0.1", r: false, t: { limit: { tif: "Gtc" as const } } };

  it("reports every order in a partly rejected batch instead of throwing", async () => {
    const { client, sent } = clientReturning({
      status: "ok",
      response: {
        type: "order",
        data: {
          statuses: [
            { resting: { oid: 1 } },
            { filled: { totalSz: "0.1", avgPx: "1999", oid: 2 } },
            { error: "Order must have minimum value of $10." },
          ],
        },
      },
    });
    const s = await submitOrders(client, [order, order, order]);
    expect(sent).toHaveLength(1);
    expect(s).toMatchObject({ total: 3, resting: 1, filled: 1, filledSize: 0.1, errors: ["Order must have minimum value of $10."] });
    expect(describeSummary(s)).toBe("1 filled (0.1 @ 1,999) · 1 resting · 1 rejected: Order must have minimum value of $10.");
  });

  it("rethrows top-level errors that carry no per-order statuses", async () => {
    const { client } = clientReturning({ status: "err", response: "User or API Wallet 0xabc does not exist." });
    await expect(submitOrders(client, [order])).rejects.toThrow(/does not exist/);
  });

  it("sends TP/SL children in the same grouped action", async () => {
    const { client, sent } = clientReturning({
      status: "ok",
      response: { type: "order", data: { statuses: [{ resting: { oid: 1 } }, "waitingForTrigger", "waitingForTrigger"] } },
    });
    const { orders, grouping } = withTpSl(eth, order, 2000, { tp: 2100, sl: 1900 });
    const s = await submitOrders(client, orders, grouping);
    expect((sent[0] as { action: { grouping: string; orders: unknown[] } }).action).toMatchObject({ grouping: "normalTpsl" });
    expect(s).toMatchObject({ resting: 1, waiting: 2 });
  });

  it("summarizes an empty batch", () => {
    expect(describeSummary(summarizeStatuses([]))).toBe("Submitted");
  });
});
