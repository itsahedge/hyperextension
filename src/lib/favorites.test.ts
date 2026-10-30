import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { loadFavorites, toggleFavorite, toggleStoredFavorite, withFavoritesFirst } from "./favorites";
import type { Market } from "./markets";

const m = (coin: string): Market => ({
  kind: "perp",
  name: coin,
  label: coin,
  dex: "",
  collateral: "USDC",
  marginMode: "normal",
  growthMode: false,
  coin,
  assetId: 0,
  szDecimals: 2,
  maxLeverage: 10,
  markPx: 1,
  midPx: 1,
  prevDayPx: 1,
  dayNtlVlm: 1,
  funding: 0,
  openInterest: 1000,
});
const markets = ["BTC", "ETH", "SOL", "HYPE"].map(m);

beforeEach(() => fakeBrowser.reset());

describe("favorites", () => {
  it("toggles on at the end and off in place", () => {
    expect(toggleFavorite(["BTC"], "SOL")).toEqual(["BTC", "SOL"]);
    expect(toggleFavorite(["BTC", "SOL"], "BTC")).toEqual(["SOL"]);
  });

  it("puts favorites first in starred order and skips missing markets", () => {
    const { favorites, rest } = withFavoritesFirst(markets, ["HYPE", "GONE", "ETH"]);
    expect(favorites.map((x) => x.coin)).toEqual(["HYPE", "ETH"]);
    expect(rest.map((x) => x.coin)).toEqual(["BTC", "SOL"]);
  });

  it("persists separately per network", async () => {
    expect(await loadFavorites()).toEqual({ mainnet: [], testnet: [] });
    await toggleStoredFavorite("mainnet", "@107");
    await toggleStoredFavorite("testnet", "BTC");
    await toggleStoredFavorite("mainnet", "ETH");
    expect(await loadFavorites()).toEqual({ mainnet: ["@107", "ETH"], testnet: ["BTC"] });
    await toggleStoredFavorite("mainnet", "@107");
    expect((await loadFavorites()).mainnet).toEqual(["ETH"]);
  });
});
