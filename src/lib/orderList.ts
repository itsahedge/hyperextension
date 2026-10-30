import type { FrontendOpenOrdersResponse, HistoricalOrdersResponse } from "@nktkas/hyperliquid/api/info";
import type { Market } from "./markets";

export type OpenOrder = FrontendOpenOrdersResponse[number];
export type HistoricalOrder = HistoricalOrdersResponse[number];
export type OrderStatus = HistoricalOrder["status"];

// Cancel targets for the given orders, skipping any whose market is unknown
// (an asset id is required to cancel).
export function cancelTargets(orders: OpenOrder[], byCoin: Map<string, Market>): { a: number; o: number }[] {
  return orders.flatMap((o) => {
    const m = byCoin.get(o.coin);
    return m ? [{ a: m.assetId, o: o.oid }] : [];
  });
}

export type SideFilter = "all" | "buy" | "sell";
// "limit": resting limit orders. "trigger": stops, take-profits, and TP/SL,
// which only become live orders when their trigger price hits.
export type KindFilter = "all" | "limit" | "trigger";

export interface OrderFilter {
  coin: string | null;
  side: SideFilter;
  kind: KindFilter;
}

export function matchesFilter(o: OpenOrder, f: OrderFilter): boolean {
  if (f.coin !== null && o.coin !== f.coin) return false;
  if (f.side !== "all" && (o.side === "B") !== (f.side === "buy")) return false;
  if (f.kind !== "all" && o.isTrigger !== (f.kind === "trigger")) return false;
  return true;
}

export function filterOrders(rows: OpenOrder[], f: OrderFilter): OpenOrder[] {
  return rows.filter((o) => matchesFilter(o, f));
}

// Rows grouped by market, markets in order of first appearance.
export function groupByCoin<T extends { coin: string }>(rows: T[]): { coin: string; rows: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) groups.set(r.coin, [...(groups.get(r.coin) ?? []), r]);
  return [...groups].map(([coin, rs]) => ({ coin, rows: rs }));
}

// Button and dialog text naming exactly which orders a bulk cancel hits.
export function scopeLabel(count: number, f: Omit<OrderFilter, "coin">, marketName: string | null): string {
  const kind = f.kind === "limit" ? "limit " : f.kind === "trigger" ? "trigger " : "";
  const side = f.side === "buy" ? "buy " : f.side === "sell" ? "sell " : "";
  const noun = count === 1 ? "order" : "orders";
  const where = marketName ? ` · ${marketName}` : " · all markets";
  return `Cancel ${count} ${side}${kind}${noun}${where}`;
}

// Short header label naming what a filtered bulk cancel hits:
// "Cancel 29 buys", "Cancel 5 sell triggers", "Cancel 12 limits".
export function headerCancelLabel(count: number, side: SideFilter, kind: KindFilter): string {
  const sideWord = side === "all" ? "" : side;
  const kindWord = kind === "all" ? "" : kind;
  const words = [sideWord, kindWord].filter(Boolean);
  if (count !== 1) words[words.length - 1] += "s";
  return `Cancel ${count} ${words.join(" ")}`;
}

export function filterByCoin<T extends { coin: string }>(rows: T[], coin: string | null): T[] {
  return coin === null ? rows : rows.filter((r) => r.coin === coin);
}

// Distinct coins with at least one row, in order of appearance.
export function coinsOf(rows: { coin: string }[]): string[] {
  return [...new Set(rows.map((r) => r.coin))];
}

export type StatusGroup = "open" | "filled" | "partial" | "triggered" | "canceled" | "rejected";

// Hyperliquid OrderProcessingStatus values: "open", "filled", "canceled",
// "triggered", "rejected", plus specific reasons ending in "Canceled" or
// "Rejected" (e.g. "marginCanceled", "perpMarginRejected").
export function statusInfo(status: OrderStatus): { group: StatusGroup; label: string; reason: string | null } {
  if (status === "open") return { group: "open", label: "Open", reason: null };
  if (status === "filled") return { group: "filled", label: "Filled", reason: null };
  if (status === "triggered") return { group: "triggered", label: "Triggered", reason: null };
  if (status === "canceled") return { group: "canceled", label: "Canceled", reason: null };
  if (status === "rejected") return { group: "rejected", label: "Rejected", reason: null };
  if (status === "scheduledCancel") return { group: "canceled", label: "Canceled", reason: "Scheduled cancel" };
  if (status.endsWith("Rejected")) return { group: "rejected", label: "Rejected", reason: humanize(status.slice(0, -"Rejected".length)) };
  if (status.endsWith("Canceled") || status.endsWith("Cancel")) {
    return { group: "canceled", label: "Canceled", reason: humanize(status.replace(/Cancel(ed)?$/, "")) };
  }
  return { group: "canceled", label: humanize(status), reason: null };
}

// "perpMargin" -> "Perp margin", "iocCancel" -> "IOC cancel".
function humanize(camel: string): string {
  const words = camel
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .map((w) => (/^(ioc|alo|px|ntl|tpsl)$/i.test(w) ? w.toUpperCase() : w.toLowerCase()));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A history row's status, plus how much of the order traded. A market order
// stopped by its slippage cap reports "filled" with the unfilled rest still
// in sz; that is a partial fill.
export function historyStatus(row: HistoricalOrder): ReturnType<typeof statusInfo> & { filled: number } {
  const left = Number(row.order.sz);
  const filled = Number(row.order.origSz) - left;
  if (row.status === "filled" && left > 0) return { group: "partial", label: "Partial", reason: null, filled };
  return { ...statusInfo(row.status), filled };
}

// Closed orders that did not fully fill (canceled, rejected, triggered, or
// partly filled), newest first. Fully filled orders are left to the fills
// list, which has the actual prices.
export function unfilledHistory(rows: HistoricalOrder[]): HistoricalOrder[] {
  return rows
    .filter((r) => r.status !== "open" && !(r.status === "filled" && Number(r.order.sz) === 0))
    .sort((a, b) => b.statusTimestamp - a.statusTimestamp);
}
