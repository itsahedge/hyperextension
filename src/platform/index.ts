import { browser, storage } from "#imports";
import type { DefineItem, Platform, StorageKey } from "./types";

export type { Platform, StorageItem, StorageKey } from "./types";

// The Chrome extension. The web build replaces this module with ./web.ts.
export const platform: Platform = {
  kind: "extension",
  defineItem: (<T>(key: StorageKey, options?: { fallback: T }) =>
    options ? storage.defineItem<T>(key, options) : storage.defineItem<T>(key)) as DefineItem,
  passkeyRpId: () => browser.runtime.id,
  storesMasterKey: true,
  passwordless: false,
  vpn: "helper",
  route: (url) => url,
  screenLock: true,
  sidePanel: true,
};
