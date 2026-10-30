import { ExchangeClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import type { OrderSpec } from "./orders";
import { describeSummary, MAX_BATCH_ORDERS, orderToast, placementHeadline, submitOrders, type PlacementSummary } from "./placement";

type Action = { type: string; orders: OrderSpec[] };

// A real ExchangeClient (real signing) over a fake transport. `respond` sees
// each signed batch; returning an Error makes that request fail outright.
function client(respond: (orders: OrderSpec[], call: number) => unknown) {
  const batches: { orders: OrderSpec[]; nonce: number }[] = [];
  const transport = {
    isTestnet: true,
    async request(_endpoint: "info" | "exchange", payload: unknown) {
      const { action, nonce } = payload as { action: Action; nonce: number };
      batches.push({ orders: action.orders, nonce });
      const r = respond(action.orders, batches.length);
      if (r instanceof Error) throw r;
      return r as never;
    },
  };
  // Well-known Anvil/Hardhat development key. Never fund it.
  const wallet = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  return { client: new ExchangeClient({ transport, wallet }), batches };
}

const resting = (orders: OrderSpec[]) => ({ status: "ok", response: { type: "order", data: { statuses: orders.map((_, i) => ({ resting: { oid: i + 1 } })) } } });
const ladder = (n: number): OrderSpec[] =>
  Array.from({ length: n }, (_, i) => ({ a: 0, b: true, p: String(50_000 + i), s: "0.001", r: false, t: { limit: { tif: "Gtc" } } }));

describe("submitOrders batching", () => {
  it("sends up to the per-action limit as one signed batch", async () => {
    const { client: c, batches } = client(resting);
    const summary = await submitOrders(c, ladder(MAX_BATCH_ORDERS));
    expect(batches.map((b) => b.orders.length)).toEqual([MAX_BATCH_ORDERS]);
    expect(summary).toMatchObject({ total: 200, resting: 200, notSent: 0, errors: [] });
  });

  it("splits a large ladder into batches of at most 200, in price order, with fresh nonces", async () => {
    const orders = ladder(500);
    const { client: c, batches } = client(resting);
    const summary = await submitOrders(c, orders);
    expect(batches.map((b) => b.orders.length)).toEqual([200, 200, 100]);
    expect(batches.flatMap((b) => b.orders.map((o) => o.p))).toEqual(orders.map((o) => o.p));
    expect(new Set(batches.map((b) => b.nonce)).size).toBe(3);
    expect(summary).toMatchObject({ total: 500, resting: 500, notSent: 0, errors: [] });
  });

  it("stops after a failed batch and reports what was and was not sent", async () => {
    const { client: c, batches } = client((orders, call) => (call === 2 ? new Error("network down") : resting(orders)));
    const summary = await submitOrders(c, ladder(450));
    // Never retried, and later batches are not sent once one fails.
    expect(batches).toHaveLength(2);
    expect(summary).toMatchObject({ total: 450, resting: 200, notSent: 250, notSentReason: "network down", errors: [] });
    expect(describeSummary(summary)).toBe("200 resting · 250 not sent: network down");
  });

  it("throws like a single batch when the first batch fails, since nothing was placed", async () => {
    const { client: c, batches } = client(() => new Error("User or API Wallet 0xabc does not exist."));
    await expect(submitOrders(c, ladder(500))).rejects.toThrow("does not exist");
    expect(batches).toHaveLength(1);
  });

  it("keeps per-order results when a batch is partly rejected", async () => {
    const { client: c } = client((orders, call) =>
      call === 1
        ? resting(orders)
        : { status: "ok", response: { type: "order", data: { statuses: orders.map((_, i) => (i === 0 ? { error: "Insufficient margin" } : { resting: { oid: i } })) } } },
    );
    const summary = await submitOrders(c, ladder(250));
    expect(summary).toMatchObject({ total: 250, resting: 249, errors: ["Insufficient margin"] });
  });

  it("refuses to split grouped TP/SL orders", async () => {
    const { client: c, batches } = client(resting);
    await expect(submitOrders(c, ladder(MAX_BATCH_ORDERS + 1), "normalTpsl")).rejects.toThrow(/at most 200/);
    expect(batches).toHaveLength(0);
  });
});

describe("placementHeadline", () => {
  const summary = (over: Partial<PlacementSummary>): PlacementSummary => ({ total: 1, resting: 0, filled: 0, filledSize: 0, filledAvgPx: 0, waiting: 0, errors: [], notSent: 0, ...over });

  it("says plainly that the orders went in", () => {
    expect(placementHeadline(summary({ total: 100, resting: 100 }))).toEqual({ tone: "success", title: "100 orders submitted", placed: true });
    expect(placementHeadline(summary({ total: 1, filled: 1 }))).toEqual({ tone: "success", title: "Order submitted", placed: true });
    expect(placementHeadline(summary({ total: 3, resting: 1, waiting: 2 }))).toEqual({ tone: "success", title: "3 orders submitted", placed: true });
  });

  it("flags partial and total failures", () => {
    expect(placementHeadline(summary({ total: 100, resting: 40, errors: Array(60).fill("Insufficient margin") }))).toEqual({ tone: "warn", title: "40 of 100 orders submitted", placed: true });
    expect(placementHeadline(summary({ total: 450, resting: 200, notSent: 250 }))).toEqual({ tone: "warn", title: "200 of 450 orders submitted", placed: true });
    expect(placementHeadline(summary({ total: 1, errors: ["Post only order would have immediately matched"] }))).toEqual({ tone: "error", title: "Order rejected", placed: false });
    expect(placementHeadline(summary({ total: 5, errors: Array(5).fill("x") }))).toEqual({ tone: "error", title: "5 orders rejected", placed: false });
  });
});

describe("orderToast", () => {
  const summary = (over: Partial<PlacementSummary>): PlacementSummary => ({ total: 1, resting: 0, filled: 0, filledSize: 0, filledAvgPx: 0, waiting: 0, errors: [], notSent: 0, ...over });

  it("titles the toast with the verdict and market, details in the body", () => {
    expect(orderToast(summary({ total: 1, filled: 1, filledSize: 18165.7, filledAvgPx: 0.512013 }), "KNTQ/USDC")).toEqual({
      tone: "success",
      title: "Order submitted on KNTQ/USDC",
      body: "1 filled (18,165.7 @ 0.512013)",
    });
    expect(orderToast(summary({ total: 100, resting: 40, errors: Array(60).fill("Insufficient margin") }), "BTC")).toMatchObject({
      tone: "warn",
      title: "40 of 100 orders submitted on BTC",
    });
    expect(orderToast(summary({ total: 1, errors: ["Post only order would have immediately matched"] }), "BTC")).toEqual({
      tone: "error",
      title: "Order rejected on BTC",
      body: "1 rejected: Post only order would have immediately matched",
    });
  });
});
