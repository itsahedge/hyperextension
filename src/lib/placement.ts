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
}

type Status =
  | { resting: { oid: number } }
  | { filled: { totalSz: string; avgPx: string; oid: number } }
  | { error: string }
  | "waitingForFill"
  | "waitingForTrigger";

export function summarizeStatuses(statuses: Status[]): PlacementSummary {
  const s: PlacementSummary = { total: statuses.length, resting: 0, filled: 0, filledSize: 0, filledAvgPx: 0, waiting: 0, errors: [] };
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
// Sends every order in one signed batch. Never retried: a resend would be a
// second set of orders. In a batch Hyperliquid accepts some orders and
// rejects others; the SDK throws on any rejection, but the error carries the
// full response, so each order's outcome is still reported.
export async function submitOrders(client: ExchangeClient, orders: OrderSpec[], grouping: Grouping = "na") {
  try {
    const res = await client.order({ orders, grouping });
    return summarizeStatuses(res.response.data.statuses as Status[]);
  } catch (err) {
    const statuses = err instanceof ApiRequestError ? statusesOf(err.response) : null;
    if (statuses) return summarizeStatuses(statuses);
    throw err;
  }
}

// For single orders, where a rejection should surface as an error.
export function assertAccepted(s: PlacementSummary): PlacementSummary {
  if (s.errors.length) throw new Error([...new Set(s.errors)].join("; "));
  return s;
}

export function describeSummary(s: PlacementSummary): string {
  const parts: string[] = [];
  if (s.filled) parts.push(`${s.filled} filled (${trim(s.filledSize)} @ ${trim(s.filledAvgPx)})`);
  if (s.resting) parts.push(`${s.resting} resting`);
  if (s.waiting) parts.push(`${s.waiting} waiting`);
  if (s.errors.length) parts.push(`${s.errors.length} rejected: ${[...new Set(s.errors)].join("; ")}`);
  return parts.join(" · ") || "Submitted";
}

function trim(n: number) {
  return n.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}
