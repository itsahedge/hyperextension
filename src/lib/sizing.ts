import { formatSize } from "@nktkas/hyperliquid/utils";

// Hyperliquid rejects orders under this notional ("Order must have minimum
// value of $10." in the exchange endpoint docs).
export const MIN_ORDER_USD = 10;

// Truncates to the market's lot size. Null when the result would be zero
// (formatSize throws on that).
export function floorSize(size: number, szDecimals: number): string | null {
  if (!(size > 0) || !Number.isFinite(size)) return null;
  try {
    return formatSize(toPlain(size), szDecimals);
  } catch {
    return null;
  }
}

// Number to decimal string without exponent notation (1e-7 -> "0.0000001").
export function toPlain(n: number): string {
  return n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
}

export function parsePositive(input: string): number | null {
  const n = Number(input.trim());
  return input.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

// Fraction of `max` as a lot-size string, or "" when it rounds to nothing.
export function sizeAtFraction(max: number, fraction: number, szDecimals: number): string {
  return floorSize(max * Math.min(Math.max(fraction, 0), 1), szDecimals) ?? "";
}

export function usdToBase(usd: number, price: number, szDecimals: number): string {
  return price > 0 ? (floorSize(usd / price, szDecimals) ?? "") : "";
}
