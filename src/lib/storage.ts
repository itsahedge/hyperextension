import { storage } from "#imports";
import type { AccountConfig } from "./account";
import type { Secrets, StoredVault } from "./vault";

// Unlocked view: the config the popup acts on travels with the keys in one
// item, so a mode switch and its key land in a single write. Local and
// session storage cannot be written atomically together; `local:config` is
// only the persisted copy that seeds the next unlock.
export interface UnlockedSession {
  config: AccountConfig;
  secrets: Secrets;
}

export interface Prefs {
  // Market-order slippage cap as a fraction (0.01 = 1%).
  slippage: number;
  // Lock after this many minutes without popup activity; 0 = never.
  autoLockMinutes: number;
  // Lock as soon as the OS reports the screen locked (chrome.idle "locked").
  lockOnScreenLock: boolean;
}

// Stored prefs may predate newer fields; read through loadPrefs, which fills
// defaults, and write through updatePrefs, which merges.
export const prefsItem = storage.defineItem<Partial<Prefs>>("local:prefs");

// Timestamp (ms) of the last popup interaction while unlocked. Session-scoped
// like the keys it guards.
export const lastActiveItem = storage.defineItem<number>("session:lastActive");

// Starred market coins per network; read through lib/favorites.
export const favoritesItem = storage.defineItem<Partial<Record<"mainnet" | "testnet", string[]>>>("local:favorites");

export const vaultItem = storage.defineItem<StoredVault>("local:vault");
export const configItem = storage.defineItem<AccountConfig>("local:config");
// chrome.storage.session lives in memory and is cleared when the browser exits,
// so decrypted keys never touch disk. Default access level excludes content scripts.
export const unlockedItem = storage.defineItem<UnlockedSession>("session:unlocked");
