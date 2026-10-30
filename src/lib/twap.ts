import type { TwapOrderParameters } from "@nktkas/hyperliquid/api/exchange";
import type { Market } from "./markets";

// Hyperliquid docs allow 5 minutes to 7 days, but the SDK's request schema
// caps `m` at 1440, so that is the binding limit here.
export const TWAP_MIN_MINUTES = 5;
export const TWAP_MAX_MINUTES = 1440;
// Hyperliquid order types docs: "$100 minimum total order size".
export const TWAP_MIN_USD = 100;

export interface TwapInput {
  market: Market;
  isBuy: boolean;
  size: string;
  minutes: number;
  // Hyperliquid randomizes each suborder up to +/-20% of its size.
  randomize: boolean;
  reduceOnly: boolean;
}

// Hyperliquid runs the TWAP server-side, on perps and spot alike (twapOrder
// takes any asset id); it keeps executing after the popup closes.
// Suborders have a 3% max slippage set by the exchange.
export function buildTwap(input: TwapInput): TwapOrderParameters {
  const { market, minutes } = input;
  if (!Number.isInteger(minutes) || minutes < TWAP_MIN_MINUTES || minutes > TWAP_MAX_MINUTES) {
    throw new Error(`Duration must be ${TWAP_MIN_MINUTES} to ${TWAP_MAX_MINUTES} minutes`);
  }
  const size = Number(input.size);
  if (!(size > 0)) throw new Error("Size must be greater than zero");
  const reference = market.midPx ?? market.markPx;
  if (size * reference < TWAP_MIN_USD) throw new Error(`TWAP total must be at least $${TWAP_MIN_USD}`);
  return {
    twap: { a: market.assetId, b: input.isBuy, s: input.size, r: market.kind === "perp" && input.reduceOnly, m: minutes, t: input.randomize },
  };
}
