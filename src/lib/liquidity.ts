export interface BookLevel {
  px: number;
  sz: number;
}

// How much of a market order the visible book fills before crossing its price
// limit (the slippage bound). Hyperliquid cancels the rest, so anything short
// of `size` would not fill. `levels` is the side the order takes from: asks
// (best first) for a buy, bids for a sell. l2Book shows 20 levels a side, so
// when every visible level is inside the limit the real book may hold more.
export function fillableWithin(levels: BookLevel[], isBuy: boolean, limitPx: number, size: number) {
  let filled = 0;
  let notional = 0;
  let allInside = true;
  for (const { px, sz } of levels) {
    if (isBuy ? px > limitPx : px < limitPx) {
      allInside = false;
      break;
    }
    const take = Math.min(sz, size - filled);
    filled += take;
    notional += take * px;
    if (filled >= size) break;
  }
  const complete = filled >= size;
  return { size: filled, notional, complete, limitedByVisibleBook: !complete && allInside };
}
