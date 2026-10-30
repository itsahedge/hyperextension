// Hyperliquid's Trade History "Closed PNL": the fill's closedPnl net of its
// fee, with a fee paid in the base token (spot buys) valued at the fill
// price. Matches the frontend to the cent on live fills (fills.test.ts).
export function netClosedPnl(f: { closedPnl: string; fee: string; feeToken: string; px: string }, baseToken: string): number {
  const fee = Number(f.fee);
  const feeInQuote = f.feeToken === baseToken ? fee * Number(f.px) : fee;
  return Number(f.closedPnl) - feeInQuote;
}

// Fill price as Hyperliquid shows it. Valid prices have at most 5
// significant figures, and integer prices are always allowed (tick-and-lot-size
// docs); an aggregated fill's average is rounded back to that form.
export function fillPrice(px: string): string {
  const n = Number(px);
  const rounded = Math.abs(n) >= 100_000 ? Math.round(n) : Number(n.toPrecision(5));
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 12 });
}

type FillLike = { sz: string; px: string; closedPnl: string; fee: string; feeToken: string };

// Totals for a set of fills (a swarm, or one of its lots): size, size-weighted
// average price, fees (feeToken null if they were paid in different tokens),
// and Closed PNL net of fees as in netClosedPnl.
export function summarizeFills(fills: FillLike[], baseToken: string) {
  let size = 0;
  let notional = 0;
  let fee = 0;
  let pnl = 0;
  for (const f of fills) {
    size += Number(f.sz);
    notional += Number(f.sz) * Number(f.px);
    fee += Number(f.fee);
    pnl += netClosedPnl(f, baseToken);
  }
  const tokens = new Set(fills.map((f) => f.feeToken));
  return { size, avgPx: size > 0 ? notional / size : 0, fee, feeToken: tokens.size === 1 ? [...tokens][0]! : null, pnl };
}
