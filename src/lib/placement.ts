import type { ExchangeClient } from "@nktkas/hyperliquid";
import { ApiRequestError } from "@nktkas/hyperliquid/api/exchange";
import type { OrderSpec } from "./orders";

export type Grouping = "na" | "normalTpsl";

export interface PlacementSummary {
  total: number;
  resting: number;
  filled: number;
  // Filled size and average price across filled orders.
  filledSize: number;
  filledAvgPx: number;
  // Untriggered children (TP/SL) and waiting states.
  waiting: number;
  errors: string[];
  // Orders never sent because an earlier batch of a split submit failed.
  notSent: number;
  notSentReason?: string;
}

type Status =
  | { resting: { oid: number } }
  | { filled: { totalSz: string; avgPx: string; oid: number } }
  | { error: string }
  | "waitingForFill"
  | "waitingForTrigger";

export function summarizeStatuses(statuses: Status[]): PlacementSummary {
  const s: PlacementSummary = { total: statuses.length, resting: 0, filled: 0, filledSize: 0, filledAvgPx: 0, waiting: 0, errors: [], notSent: 0 };
  let filledNotional = 0;
  for (const st of statuses) {
    if (typeof st === "string") s.waiting++;
    else if ("resting" in st) s.resting++;
    else if ("filled" in st) {
      s.filled++;
      s.filledSize += Number(st.filled.totalSz);
      filledNotional += Number(st.filled.totalSz) * Number(st.filled.avgPx);
    } else s.errors.push(st.error);
  }
  s.filledAvgPx = s.filledSize > 0 ? filledNotional / s.filledSize : 0;
  return s;
}

function statusesOf(response: unknown): Status[] | null {
  const statuses = (response as { response?: { data?: { statuses?: unknown } } })?.response?.data?.statuses;
  return Array.isArray(statuses) ? (statuses as Status[]) : null;
}

// The only place orders are sent. Personal tool: never attach a builder code
// (the optional `builder` order field, { b, f }, that routes a fee to a third
// party); orders.test.ts asserts no signed payload carries one.
//
// Most orders one signed action may carry. Not in Hyperliquid's docs:
// measured on mainnet and testnet (2026-10-29), 200 orders pass and 201 fail
// with "Signed action over weight limit of 200".
export const MAX_BATCH_ORDERS = 200;

// Sends the orders as signed batches of at most MAX_BATCH_ORDERS, in order.
// Never retried: a resend would be a second set of orders. In a batch
// Hyperliquid accepts some orders and rejects others; the SDK throws on any
// rejection, but the error carries the full response, so each order's outcome
// is still reported. If the first batch fails outright (network, signing,
// unknown wallet) nothing was placed and the error is thrown; if a later one
// does, the orders already placed are reported and the rest counted as not sent.
export async function submitOrders(client: ExchangeClient, orders: OrderSpec[], grouping: Grouping = "na") {
  // TP/SL children only attach to a parent in the same action.
  if (grouping !== "na" && orders.length > MAX_BATCH_ORDERS) {
    throw new Error(`Grouped TP/SL orders must fit in one batch of at most ${MAX_BATCH_ORDERS}`);
  }
  if (orders.length <= MAX_BATCH_ORDERS) return summarizeStatuses(await submitBatch(client, orders, grouping));

  const statuses: Status[] = [];
  for (let i = 0; i < orders.length; i += MAX_BATCH_ORDERS) {
    try {
      statuses.push(...(await submitBatch(client, orders.slice(i, i + MAX_BATCH_ORDERS), grouping)));
    } catch (err) {
      if (i === 0) throw err;
      const summary = summarizeStatuses(statuses);
      summary.total = orders.length;
      summary.notSent = orders.length - i;
      summary.notSentReason = err instanceof Error ? err.message : String(err);
      return summary;
    }
  }
  return summarizeStatuses(statuses);
}

async function submitBatch(client: ExchangeClient, orders: OrderSpec[], grouping: Grouping): Promise<Status[]> {
  try {
    const res = await client.order({ orders, grouping });
    return res.response.data.statuses as Status[];
  } catch (err) {
    const statuses = err instanceof ApiRequestError ? statusesOf(err.response) : null;
    if (statuses) return statuses;
    throw err;
  }
}

export interface CancelSummary {
  total: number;
  canceled: number;
  errors: string[];
}

export function summarizeCancels(statuses: ("success" | { error: string })[]): CancelSummary {
  const errors = statuses.flatMap((s) => (s === "success" ? [] : [s.error]));
  return { total: statuses.length, canceled: statuses.length - errors.length, errors };
}

// One signed batch for any number of cancels. Like orders, the SDK throws if
// any cancel fails, but the error carries every per-order status.
export async function cancelOrders(client: ExchangeClient, cancels: { a: number; o: number }[]): Promise<CancelSummary> {
  if (cancels.length === 0) return { total: 0, canceled: 0, errors: [] };
  try {
    const res = await client.cancel({ cancels });
    return summarizeCancels(res.response.data.statuses);
  } catch (err) {
    const statuses = err instanceof ApiRequestError ? statusesOf(err.response) : null;
    if (statuses) return summarizeCancels(statuses as ("success" | { error: string })[]);
    throw err;
  }
}

export function describeCancels(s: CancelSummary): string {
  const done = `${s.canceled} of ${s.total} canceled`;
  return s.errors.length ? `${done}; ${[...new Set(s.errors)].join("; ")}` : done;
}

// For single orders, where a rejection should surface as an error.
export function assertAccepted(s: PlacementSummary): PlacementSummary {
  if (s.errors.length) throw new Error([...new Set(s.errors)].join("; "));
  if (s.notSent) throw new Error(`${s.notSent} not sent: ${s.notSentReason}`);
  return s;
}

// The one-line verdict shown after submitting. `placed` is true when any order
// reached the book (resting, filled or waiting), which is when the order form
// is cleared so a second click cannot send a duplicate.
export function placementHeadline(s: PlacementSummary): { tone: "success" | "warn" | "error"; title: string; placed: boolean } {
  const placed = s.resting + s.filled + s.waiting;
  const orders = (n: number) => (n === 1 ? "Order" : `${n} orders`);
  if (placed === 0) return { tone: "error", title: `${orders(s.total)} rejected`, placed: false };
  if (placed < s.total) return { tone: "warn", title: `${placed} of ${s.total} orders submitted`, placed: true };
  return { tone: "success", title: `${orders(s.total)} submitted`, placed: true };
}

// Toast content for a submit: the verdict and market as the title, the
// per-order breakdown as the body.
export function orderToast(s: PlacementSummary, marketName: string): { tone: "success" | "warn" | "error"; title: string; body: string } {
  const { tone, title } = placementHeadline(s);
  return { tone, title: `${title} on ${marketName}`, body: describeSummary(s) };
}

export function describeSummary(s: PlacementSummary): string {
  const parts: string[] = [];
  if (s.filled) parts.push(`${s.filled} filled (${trim(s.filledSize)} @ ${trim(s.filledAvgPx)})`);
  if (s.resting) parts.push(`${s.resting} resting`);
  if (s.waiting) parts.push(`${s.waiting} waiting`);
  if (s.errors.length) parts.push(`${s.errors.length} rejected: ${[...new Set(s.errors)].join("; ")}`);
  if (s.notSent) parts.push(`${s.notSent} not sent: ${s.notSentReason}`);
  return parts.join(" · ") || "Submitted";
}

function trim(n: number) {
  return n.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}
