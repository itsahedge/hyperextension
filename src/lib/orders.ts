import type { ExchangeClient } from "@nktkas/hyperliquid";
import type { OrderParameters } from "@nktkas/hyperliquid/api/exchange";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import type { Market } from "./markets";

export type OrderSpec = OrderParameters["orders"][number];
export type OrderType = "market" | "limit";
export type LimitTif = "Gtc" | "Alo";

export interface OrderInput {
  market: Market;
  isBuy: boolean;
  size: string;
  type: OrderType;
  // Limit orders only.
  price?: string;
  tif?: LimitTif;
  reduceOnly?: boolean;
  // Market orders only: fraction, e.g. 0.01 = 1% worse than mid.
  slippage?: number;
}

export const DEFAULT_SLIPPAGE = 0.01;

// Hyperliquid has no native market order: a market order is an IOC-style
// limit at a price bounded by the allowed slippage from the reference price.
export function marketPrice(market: Market, isBuy: boolean, slippage: number): string {
  if (!(slippage > 0 && slippage < 1)) throw new Error("Slippage must be between 0% and 100%");
  const reference = market.midPx ?? market.markPx;
  if (!(reference > 0)) throw new Error(`No price available for ${market.name}`);
  const bounded = reference * (isBuy ? 1 + slippage : 1 - slippage);
  return formatPrice(bounded, market.szDecimals, market.kind);
}

export function buildOrder(input: OrderInput): OrderSpec {
  const { market, isBuy, type } = input;
  const size = Number(input.size);
  if (!Number.isFinite(size) || size <= 0) throw new Error("Size must be greater than zero");
  const s = formatSize(input.size.trim(), market.szDecimals);
  if (Number(s) === 0) throw new Error(`Size is below the minimum step (${market.szDecimals} decimals)`);

  let p: string;
  if (type === "market") {
    p = marketPrice(market, isBuy, input.slippage ?? DEFAULT_SLIPPAGE);
  } else {
    const price = Number(input.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error("Price must be greater than zero");
    p = formatPrice(input.price!.trim(), market.szDecimals, market.kind);
  }

  return {
    a: market.assetId,
    b: isBuy,
    p,
    s,
    r: market.kind === "perp" && Boolean(input.reduceOnly),
    t: { limit: { tif: type === "market" ? "FrontendMarket" : (input.tif ?? "Gtc") } },
  };
}

// The only place orders are sent. Personal tool: never attach a builder code
// (the optional `builder` order field, { b, f }, that routes a fee to a third
// party). orders.test.ts asserts the signed payload carries none.
export function placeOrder(client: ExchangeClient, order: OrderSpec) {
  return client.order({ orders: [order], grouping: "na" });
}

// Reduce-only market order for the full position size, opposite side.
export function buildClose(market: Market, signedSize: string, slippage = DEFAULT_SLIPPAGE): OrderSpec {
  const szi = Number(signedSize);
  if (szi === 0) throw new Error("No position to close");
  return buildOrder({
    market,
    isBuy: szi < 0,
    // Keep the API's decimal string; String(Math.abs(n)) can produce "1e-7".
    size: signedSize.replace(/^-/, ""),
    type: "market",
    reduceOnly: true,
    slippage,
  });
}
