import { describe, expect, it } from "vitest";
import { fillPrice, netClosedPnl, summarizeFills } from "./fills";

// Live aggregated userFills for 0xEfd8…8808 and the values Hyperliquid's own
// Trade History shows for them (Closed PNL, Price), 2026-10-29.
const FILLS = [
  { side: "A", px: "0.5162860289", closedPnl: "23.43082071", fee: "7.0460972", feeToken: "USDC", hlPnl: 16.38, hlPx: "0.51629" },
  { side: "B", px: "0.5160114148", closedPnl: "0.0", fee: "8.17732996", feeToken: "KNTQ", hlPnl: -4.22, hlPx: "0.51601" },
  { side: "B", px: "0.512802081", closedPnl: "0.0", fee: "5.47989392", feeToken: "KNTQ", hlPnl: -2.81, hlPx: "0.5128" },
  { side: "A", px: "0.527535414", closedPnl: "634.23142011", fee: "6.49481238", feeToken: "USDC", hlPnl: 627.74, hlPx: "0.52754" },
  { side: "A", px: "0.5286304943", closedPnl: "653.49", fee: "6.50829454", feeToken: "USDC", hlPnl: 646.98, hlPx: "0.52863" },
  { side: "A", px: "0.5298381166", closedPnl: "726.63", fee: "7.02494237", feeToken: "USDC", hlPnl: 719.61, hlPx: "0.52984" },
  { side: "B", px: "0.4916011636", closedPnl: "0.0", fee: "22.25674497", feeToken: "KNTQ", hlPnl: -10.94, hlPx: "0.4916" },
  { side: "B", px: "81.095", closedPnl: "0.0", fee: "0.00034299", feeToken: "HYPE", hlPnl: -0.03, hlPx: "81.095" },
];

describe("netClosedPnl", () => {
  it.each(FILLS)("matches Hyperliquid's Closed PNL ($side @ $px)", (f) => {
    const base = f.feeToken === "USDC" ? "KNTQ" : f.feeToken;
    expect(netClosedPnl(f, base)).toBeCloseTo(f.hlPnl, 2);
  });

  it("values a perp fill's USDC fee as is", () => {
    expect(netClosedPnl({ closedPnl: "-12.5", fee: "1.25", feeToken: "USDC", px: "77853" }, "BTC")).toBeCloseTo(-13.75, 10);
  });
});

describe("fillPrice", () => {
  it.each(FILLS)("rounds the aggregated average like Hyperliquid ($px)", (f) => {
    expect(fillPrice(f.px)).toBe(f.hlPx);
  });

  it("keeps integer prices of 100,000 and up whole (allowed regardless of significant figures)", () => {
    expect(fillPrice("123456.4")).toBe("123,456");
    expect(fillPrice("77853.24")).toBe("77,853");
    expect(fillPrice("0.000012345678")).toBe("0.000012346");
  });
});

describe("summarizeFills", () => {
  // Three lots of the 2026-10-30 KNTQ swarm (Hyperliquid Trade History values).
  const lots = [
    { sz: "415.14", px: "0.49203", closedPnl: "0.0", fee: "0.29059799", feeToken: "KNTQ" },
    { sz: "355.60", px: "0.49203", closedPnl: "0.0", fee: "0.24891998", feeToken: "KNTQ" },
    { sz: "554.51", px: "0.49124", closedPnl: "0.0", fee: "0.38815699", feeToken: "KNTQ" },
  ];

  it("sums size, fees and net PnL and size-weights the price", () => {
    const s = summarizeFills(lots, "KNTQ");
    expect(s.size).toBeCloseTo(1325.25, 8);
    expect(s.avgPx).toBeCloseTo((415.14 * 0.49203 + 355.6 * 0.49203 + 554.51 * 0.49124) / 1325.25, 10);
    expect(s.fee).toBeCloseTo(0.92767496, 8);
    expect(s.feeToken).toBe("KNTQ");
    // Each lot's fee valued at its price; Hyperliquid shows these rounded
    // per row as -0.14, -0.12, -0.19.
    expect(s.pnl).toBeCloseTo(-(0.29059799 * 0.49203 + 0.24891998 * 0.49203 + 0.38815699 * 0.49124), 10);
  });

  it("reports a mixed fee token as null", () => {
    expect(summarizeFills([lots[0]!, { ...lots[1]!, feeToken: "USDC" }], "KNTQ").feeToken).toBeNull();
  });
});
