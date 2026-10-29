import type { Network } from "./account";
import type { Market } from "./markets";
import { favoritesItem } from "./storage";

// Keyed by market coin ("BTC", "@107"). Spot coins are per-network indexes,
// so each network keeps its own list.
export type Favorites = Record<Network, string[]>;

export const NO_FAVORITES: Favorites = { mainnet: [], testnet: [] };

// Adds to the end (favorites keep the order they were starred) or removes.
export function toggleFavorite(list: string[], coin: string): string[] {
  return list.includes(coin) ? list.filter((c) => c !== coin) : [...list, coin];
}

// Favorites first, in starred order, then everything else in its existing
// (volume) order. Favorites whose market no longer exists are skipped.
export function withFavoritesFirst(markets: Market[], favorites: string[]): { favorites: Market[]; rest: Market[] } {
  const set = new Set(favorites);
  const byCoin = new Map(markets.map((m) => [m.coin, m]));
  return {
    favorites: favorites.flatMap((c) => byCoin.get(c) ?? []),
    rest: markets.filter((m) => !set.has(m.coin)),
  };
}

export async function loadFavorites(): Promise<Favorites> {
  return { ...NO_FAVORITES, ...(await favoritesItem.getValue()) };
}

export async function toggleStoredFavorite(network: Network, coin: string): Promise<Favorites> {
  const current = await loadFavorites();
  const next = { ...current, [network]: toggleFavorite(current[network], coin) };
  await favoritesItem.setValue(next);
  return next;
}
