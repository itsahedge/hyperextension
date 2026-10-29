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

export function filterByCoin<T extends { coin: string }>(rows: T[], coin: string | null): T[] {
  return coin === null ? rows : rows.filter((r) => r.coin === coin);
}

// Distinct coins with at least one row, in order of appearance.
export function coinsOf(rows: { coin: string }[]): string[] {
  return [...new Set(rows.map((r) => r.coin))];
}

export type StatusGroup = "open" | "filled" | "triggered" | "canceled" | "rejected";

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

// History rows that are no longer open, newest first.
export function closedHistory(rows: HistoricalOrder[]): HistoricalOrder[] {
  return rows.filter((r) => r.status !== "open").sort((a, b) => b.statusTimestamp - a.statusTimestamp);
}
