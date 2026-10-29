import { formatPrice } from "@nktkas/hyperliquid/utils";
import type { Market } from "./markets";
import type { OrderSpec } from "./orders";

// Hyperliquid TP/SL docs: "TP/SL market orders have a slippage tolerance of
// 10%." A triggered market order still carries a limit price; the official
// Python SDK sends one beyond the trigger in the adverse direction.
export const TRIGGER_MARKET_SLIPPAGE = 0.1;

export type TpSl = "tp" | "sl";

// Hyperliquid order types: a Stop long triggers above the mid, a Take long
// below it (and the reverse for shorts). Picking the kind from the trigger's
// side of the mid makes the order fire when price reaches the trigger.
export function triggerKind(isBuy: boolean, triggerPx: number, mid: number): TpSl {
  return isBuy === triggerPx > mid ? "sl" : "tp";
}

function adversePrice(market: Market, isBuy: boolean, triggerPx: number) {
  const px = triggerPx * (isBuy ? 1 + TRIGGER_MARKET_SLIPPAGE : 1 - TRIGGER_MARKET_SLIPPAGE);
  return formatPrice(px, market.szDecimals, market.kind);
}

export interface TriggerInput {
  market: Market;
  isBuy: boolean;
  size: string;
  triggerPx: number;
  // Stop-limit only; omitted means stop-market.
  limitPx?: number;
  reduceOnly: boolean;
}

export function buildTrigger(input: TriggerInput): OrderSpec {
  const { market, isBuy, triggerPx } = input;
  if (market.kind !== "perp") throw new Error("Stop orders are available on perps only");
  if (!(triggerPx > 0)) throw new Error("Enter a trigger price");
  if (input.limitPx !== undefined && !(input.limitPx > 0)) throw new Error("Enter a limit price");
  const mid = market.midPx ?? market.markPx;
  if (triggerPx === mid) throw new Error("Trigger price equals the current price");
  const isMarket = input.limitPx === undefined;
  return {
    a: market.assetId,
    b: isBuy,
    p: isMarket ? adversePrice(market, isBuy, triggerPx) : formatPrice(input.limitPx!, market.szDecimals, market.kind),
    s: input.size,
    r: input.reduceOnly,
    t: {
      trigger: {
        isMarket,
        triggerPx: formatPrice(triggerPx, market.szDecimals, market.kind),
        tpsl: triggerKind(isBuy, triggerPx, mid),
      },
    },
  };
}

// Entry with attached TP and/or SL (Hyperliquid "normalTpsl" grouping). The
// children are reduce-only market triggers sized to the entry. Hyperliquid
// places them only if the entry fully fills; a partially filled entry that
// is cancelled cancels them too.
export function withTpSl(
  market: Market,
  entry: OrderSpec,
  entryPx: number,
  targets: { tp?: number; sl?: number },
): { orders: OrderSpec[]; grouping: "normalTpsl" } {
  if (market.kind !== "perp") throw new Error("TP/SL is available on perps only");
  if (targets.tp === undefined && targets.sl === undefined) throw new Error("Set a take-profit or stop-loss price");
  const long = entry.b;
  if (targets.tp !== undefined && (long ? targets.tp <= entryPx : targets.tp >= entryPx)) {
    throw new Error(`Take-profit must be ${long ? "above" : "below"} the entry price`);
  }
  if (targets.sl !== undefined && (long ? targets.sl >= entryPx : targets.sl <= entryPx)) {
    throw new Error(`Stop-loss must be ${long ? "below" : "above"} the entry price`);
  }
  const child = (px: number, tpsl: TpSl): OrderSpec => ({
    a: market.assetId,
    b: !long,
    p: adversePrice(market, !long, px),
    s: entry.s,
    r: true,
    t: { trigger: { isMarket: true, triggerPx: formatPrice(px, market.szDecimals, market.kind), tpsl } },
  });
  const orders = [entry];
  if (targets.tp !== undefined) orders.push(child(targets.tp, "tp"));
  if (targets.sl !== undefined) orders.push(child(targets.sl, "sl"));
  return { orders, grouping: "normalTpsl" };
}
