import type { MetaAndAssetCtxsResponse, SpotMetaAndAssetCtxsResponse } from "@nktkas/hyperliquid/api/info";
import { describe, expect, it } from "vitest";
import { buildMarkets, freeBalance, marketByCoin, spotHoldings, spotTokenPrice, spotUsdValue, usdcTokenId, withLiveCtx } from "./markets";

const perpCtx = (markPx: string, dayNtlVlm: string) => ({
  prevDayPx: markPx,
  dayNtlVlm,
  markPx,
  midPx: markPx,
  funding: "0.0000125",
  openInterest: "1",
  premium: null,
  oraclePx: markPx,
  impactPxs: null,
  dayBaseVlm: "1",
});

const perp = [
  {
    universe: [
      { name: "BTC", szDecimals: 5, maxLeverage: 40, marginTableId: 1 },
      { name: "OLD", szDecimals: 0, maxLeverage: 3, marginTableId: 1, isDelisted: true },
      { name: "ETH", szDecimals: 4, maxLeverage: 25, marginTableId: 1 },
    ],
    marginTables: [],
    collateralToken: 0,
  },
  [perpCtx("100000", "100"), perpCtx("1", "9999"), perpCtx("4000", "500")],
] as unknown as MetaAndAssetCtxsResponse;

const token = (name: string, index: number, szDecimals: number) => ({
  name,
  index,
  szDecimals,
  weiDecimals: 8,
  tokenId: `0x${index.toString(16).padStart(32, "0")}`,
  isCanonical: true,
  evmContract: null,
  fullName: null,
  deployerTradingFeeShare: "0",
});

const spotCtx = (coin: string, markPx: string, midPx: string | null = markPx) => ({
  prevDayPx: markPx,
  dayNtlVlm: "10",
  markPx,
  midPx,
  circulatingSupply: "1",
  coin,
  totalSupply: "1",
  dayBaseVlm: "1",
});

const spot = [
  {
    universe: [
      { tokens: [1, 0], name: "PURR/USDC", index: 0, isCanonical: true },
      { tokens: [150, 0], name: "@107", index: 107, isCanonical: false },
      { tokens: [999, 0], name: "@500", index: 500, isCanonical: false },
    ],
    tokens: [token("USDC", 0, 8), token("PURR", 1, 0), token("HYPE", 150, 2)],
  },
  [spotCtx("PURR/USDC", "0.2"), spotCtx("@107", "40", null)],
] as unknown as SpotMetaAndAssetCtxsResponse;

describe("buildMarkets", () => {
  const markets = buildMarkets(perp, spot);

  it("indexes perps by universe position and skips delisted ones", () => {
    const perps = markets.filter((m) => m.kind === "perp");
    expect(perps.map((m) => [m.name, m.assetId])).toEqual([
      ["ETH", 2],
      ["BTC", 0],
    ]);
  });

  it("names spot pairs from tokens and offsets asset ids by 10000", () => {
    const hype = markets.find((m) => m.name === "HYPE/USDC")!;
    expect(hype).toMatchObject({ coin: "@107", assetId: 10_107, szDecimals: 2, midPx: null, markPx: 40 });
    expect(markets.find((m) => m.name === "PURR/USDC")?.assetId).toBe(10_000);
  });

  it("parses perp open interest and leaves it null for spot", () => {
    expect(markets.find((m) => m.coin === "BTC")?.openInterest).toBe(1);
    expect(markets.find((m) => m.coin === "@107")?.openInterest).toBeNull();
  });

  it("drops spot pairs with unknown tokens or no context", () => {
    expect(markets.some((m) => m.coin === "@500")).toBe(false);
  });

  it("lists perps before spot", () => {
    const firstSpot = markets.findIndex((m) => m.kind === "spot");
    expect(markets.slice(firstSpot).every((m) => m.kind === "spot")).toBe(true);
  });
});

describe("spot valuation", () => {
  const markets = buildMarkets(perp, spot);

  it("prices USDC at 1 and other tokens via their /USDC pair", () => {
    expect(spotTokenPrice("USDC", markets)).toBe(1);
    expect(spotTokenPrice("HYPE", markets)).toBe(40);
    expect(spotTokenPrice("NOPE", markets)).toBeNull();
  });

  it("sums balances, ignoring unpriced tokens", () => {
    expect(
      spotUsdValue(
        [
          { coin: "USDC", total: "100" },
          { coin: "HYPE", total: "2.5" },
          { coin: "NOPE", total: "1000" },
        ],
        markets,
      ),
    ).toBe(200);
  });
});

describe("spotHoldings", () => {
  const markets = buildMarkets(perp, spot);

  it("drops zero balances, prices tokens, and sorts by USD value with unpriced last", () => {
    expect(
      spotHoldings(
        [
          { coin: "NOPE", total: "1000", hold: "0.0" },
          { coin: "USDC", total: "50", hold: "0.0" },
          { coin: "PURR", total: "0.0", hold: "0.0" },
          { coin: "HYPE", total: "2.5", hold: "0.0" },
          { coin: "ABC", total: "3", hold: "0.0" },
        ],
        markets,
      ),
    ).toEqual([
      { coin: "HYPE", total: "2.5", available: 2.5, usd: 100 },
      { coin: "USDC", total: "50", available: 50, usd: 50 },
      { coin: "ABC", total: "3", available: 3, usd: null },
      { coin: "NOPE", total: "1000", available: 1000, usd: null },
    ]);
  });

  it("reports the balance not reserved by open orders as available", () => {
    // Live account with 20 resting spot buys: Hyperliquid's UI shows 20,362.68903122 available.
    const [usdc] = spotHoldings([{ coin: "USDC", total: "28607.85672852", hold: "8245.1676973" }], markets);
    expect(usdc?.available).toBeCloseTo(20362.68903122, 6);
    expect(usdc?.total).toBe("28607.85672852");
  });

  it("returns an empty list when everything is zero", () => {
    expect(spotHoldings([{ coin: "USDC", total: "0.0", hold: "0.0" }], markets)).toEqual([]);
  });
});

describe("freeBalance", () => {
  it("subtracts hold", () => {
    expect(freeBalance({ total: "100", hold: "30" })).toBe(70);
  });
  it("never exceeds total when hold is negative (portfolio margin borrow)", () => {
    expect(freeBalance({ total: "36716.98", hold: "-379280.92" })).toBe(36716.98);
  });
  it("never goes below zero", () => {
    expect(freeBalance({ total: "10", hold: "15" })).toBe(0);
  });
});

describe("usdcTokenId", () => {
  it("formats NAME:tokenId", () => {
    expect(usdcTokenId(spot[0])).toBe(`USDC:0x${"0".repeat(32)}`);
  });
});

describe("withLiveCtx", () => {
  const markets = buildMarkets(perp, spot);
  const data = { markets, byCoin: marketByCoin(markets) };

  it("updates only the pushed market's prices, keeping its identity fields", () => {
    const btc = data.byCoin.get("BTC")!;
    const next = withLiveCtx(data, "BTC", { ...perpCtx("101000", "5000000"), funding: "0.0001", openInterest: "7" });
    const live = next.byCoin.get("BTC")!;
    expect(live).toMatchObject({ kind: "perp", assetId: btc.assetId, szDecimals: btc.szDecimals, markPx: 101000, dayNtlVlm: 5000000, funding: 0.0001, openInterest: 7 });
    expect(next.markets.find((m) => m.coin === "BTC")).toBe(live);
    expect(next.byCoin.get("ETH")).toBe(data.byCoin.get("ETH"));
  });

  it("keeps spot markets without funding or open interest", () => {
    const hype = markets.find((m) => m.kind === "spot")!;
    const next = withLiveCtx(data, hype.coin, { ...perpCtx("42", "1"), funding: "0.5", openInterest: "9" });
    expect(next.byCoin.get(hype.coin)).toMatchObject({ markPx: 42, funding: null, openInterest: null });
  });

  it("ignores coins it does not know", () => {
    expect(withLiveCtx(data, "NOPE", perpCtx("1", "1"))).toBe(data);
  });
});
