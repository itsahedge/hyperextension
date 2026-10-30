import { ExchangeClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import type { Market } from "./markets";
import {
  cancelTargets,
  historyStatus,
  coinsOf,
  filterByCoin,
  filterOrders,
  groupByCoin,
  scopeLabel,
  statusInfo,
  unfilledHistory,
  type HistoricalOrder,
  type OpenOrder,
} from "./orderList";
import { cancelOrders, describeCancels, summarizeCancels } from "./placement";

const market = (coin: string, assetId: number): Market => ({
  kind: "perp",
  name: coin,
  label: coin,
  dex: "",
  collateral: "USDC",
  marginMode: "normal",
  growthMode: false,
  coin,
  assetId,
  szDecimals: 3,
  maxLeverage: 10,
  markPx: 1,
  midPx: 1,
  prevDayPx: 1,
  dayNtlVlm: 1,
  funding: 0,
  openInterest: 1000,
});
const byCoin = new Map([
  ["BTC", market("BTC", 0)],
  ["ETH", market("ETH", 1)],
]);
const order = (coin: string, oid: number) => ({ coin, oid }) as OpenOrder;

describe("open order helpers", () => {
  const orders = [order("BTC", 11), order("ETH", 12), order("BTC", 13), order("UNKNOWN", 14)];

  it("builds cancel targets with asset ids and skips unknown markets", () => {
    expect(cancelTargets(orders, byCoin)).toEqual([
      { a: 0, o: 11 },
      { a: 1, o: 12 },
      { a: 0, o: 13 },
    ]);
  });

  it("filters by coin and lists distinct coins in order", () => {
    expect(filterByCoin(orders, "BTC").map((o) => o.oid)).toEqual([11, 13]);
    expect(filterByCoin(orders, null)).toHaveLength(4);
    expect(coinsOf(orders)).toEqual(["BTC", "ETH", "UNKNOWN"]);
  });
});

describe("filters and scope", () => {
  const o = (coin: string, oid: number, side: "B" | "A", isTrigger: boolean) => ({ coin, oid, side, isTrigger }) as OpenOrder;
  const rows = [o("BTC", 1, "B", false), o("BTC", 2, "A", false), o("BTC", 3, "A", true), o("ETH", 4, "A", false), o("ETH", 5, "B", true)];
  const ids = (f: Parameters<typeof filterOrders>[1]) => filterOrders(rows, f).map((r) => r.oid);

  it("filters by market, side, and kind independently and combined", () => {
    expect(ids({ coin: null, side: "all", kind: "all" })).toEqual([1, 2, 3, 4, 5]);
    expect(ids({ coin: "BTC", side: "all", kind: "all" })).toEqual([1, 2, 3]);
    expect(ids({ coin: null, side: "sell", kind: "all" })).toEqual([2, 3, 4]);
    expect(ids({ coin: null, side: "all", kind: "trigger" })).toEqual([3, 5]);
    expect(ids({ coin: "BTC", side: "sell", kind: "limit" })).toEqual([2]);
    expect(ids({ coin: "ETH", side: "buy", kind: "limit" })).toEqual([]);
  });

  it("groups by market in order of appearance", () => {
    expect(groupByCoin(rows).map((g) => [g.coin, g.rows.length])).toEqual([
      ["BTC", 3],
      ["ETH", 2],
    ]);
  });

  it("labels exactly what a bulk cancel hits", () => {
    expect(scopeLabel(10, { side: "sell", kind: "all" }, "KNTQ/USDC")).toBe("Cancel 10 sell orders · KNTQ/USDC");
    expect(scopeLabel(3, { side: "all", kind: "limit" }, null)).toBe("Cancel 3 limit orders · all markets");
    expect(scopeLabel(1, { side: "buy", kind: "trigger" }, "BTC")).toBe("Cancel 1 buy trigger order · BTC");
    expect(scopeLabel(25, { side: "all", kind: "all" }, null)).toBe("Cancel 25 orders · all markets");
  });
});

describe("statusInfo", () => {
  it("maps base statuses", () => {
    expect(statusInfo("filled")).toEqual({ group: "filled", label: "Filled", reason: null });
    expect(statusInfo("open").group).toBe("open");
    expect(statusInfo("triggered").group).toBe("triggered");
  });

  it("derives a readable reason from specific cancel/reject statuses", () => {
    expect(statusInfo("marginCanceled")).toEqual({ group: "canceled", label: "Canceled", reason: "Margin" });
    expect(statusInfo("perpMarginRejected")).toEqual({ group: "rejected", label: "Rejected", reason: "Perp margin" });
    expect(statusInfo("iocCancelRejected")).toEqual({ group: "rejected", label: "Rejected", reason: "IOC cancel" });
    expect(statusInfo("reduceOnlyCanceled").reason).toBe("Reduce only");
    expect(statusInfo("scheduledCancel")).toEqual({ group: "canceled", label: "Canceled", reason: "Scheduled cancel" });
  });
});

const row = (status: string, statusTimestamp: number, origSz: string, sz: string) =>
  ({ status, statusTimestamp, order: { origSz, sz } }) as unknown as HistoricalOrder;

describe("unfilledHistory", () => {
  it("keeps orders that did not fully fill, newest first", () => {
    const rows = [
      row("filled", 1, "10", "0.0"), // fully filled: in Trade History instead
      row("open", 5, "10", "10"),
      row("canceled", 3, "10", "10"),
      row("filled", 4, "28073.23", "20244.81"), // market order cut off by its slippage cap
      row("canceled", 2, "10", "4"), // limit partly filled, then canceled
      row("perpMarginRejected", 6, "10", "10"),
    ];
    expect(unfilledHistory(rows).map((r) => r.statusTimestamp)).toEqual([6, 4, 3, 2]);
  });
});

describe("historyStatus", () => {
  it("labels a filled order with size left over as a partial fill", () => {
    expect(historyStatus(row("filled", 1, "28073.23", "20244.81"))).toMatchObject({ group: "partial", label: "Partial" });
    expect(historyStatus(row("filled", 1, "10", "0.0"))).toMatchObject({ group: "filled", label: "Filled" });
    expect(historyStatus(row("marginCanceled", 1, "10", "4"))).toMatchObject({ group: "canceled", reason: "Margin" });
  });

  it("reports filled vs ordered size when part of the order traded", () => {
    expect(historyStatus(row("filled", 1, "28073.23", "20244.81")).filled).toBeCloseTo(7828.42, 6);
    expect(historyStatus(row("canceled", 1, "10", "10")).filled).toBe(0);
  });
});

describe("cancelOrders", () => {
  // Well-known Anvil/Hardhat development key. Never fund it.
  const wallet = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const clientReturning = (response: unknown) => {
    const sent: { action: { type: string; cancels: unknown[] } }[] = [];
    const transport = {
      isTestnet: true,
      async request(_e: "info" | "exchange", payload: unknown) {
        sent.push(payload as never);
        return response as never;
      },
    };
    return { client: new ExchangeClient({ transport, wallet }), sent };
  };

  it("sends all cancels in one batch and reports partial failures", async () => {
    const { client, sent } = clientReturning({
      status: "ok",
      response: { type: "cancel", data: { statuses: ["success", { error: "Order was never placed, already canceled, or filled." }, "success"] } },
    });
    const s = await cancelOrders(client, [
      { a: 0, o: 1 },
      { a: 0, o: 2 },
      { a: 1, o: 3 },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.action).toMatchObject({ type: "cancel" });
    expect(sent[0]!.action.cancels).toHaveLength(3);
    expect(s).toEqual({ total: 3, canceled: 2, errors: ["Order was never placed, already canceled, or filled."] });
    expect(describeCancels(s)).toBe("2 of 3 canceled; Order was never placed, already canceled, or filled.");
  });

  it("does nothing for an empty list", async () => {
    const { client, sent } = clientReturning({});
    expect(await cancelOrders(client, [])).toEqual({ total: 0, canceled: 0, errors: [] });
    expect(sent).toHaveLength(0);
  });

  it("summarizes all-success", () => {
    expect(describeCancels(summarizeCancels(["success", "success"]))).toBe("2 of 2 canceled");
  });
});
