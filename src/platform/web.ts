import { relayUrl } from "./relay";
import type { Platform } from "./types";
import { createWebStorage } from "./webStorage";

export type { Platform, StorageItem, StorageKey } from "./types";

// The web app (served from the Mac mini over Tailscale). vite.web.config.ts
// aliases "@/platform" to this module.
const store = createWebStorage(window.localStorage);
window.addEventListener("storage", (e) => {
  if (e.storageArea === window.localStorage) store.onExternalChange(e.key, e.oldValue, e.newValue);
});

export const platform: Platform = {
  kind: "web",
  defineItem: store.defineItem,
  passkeyRpId: () => window.location.hostname,
  storesMasterKey: false,
  passwordless: true,
  vpn: "relay",
  route: (url) => relayUrl(url, window.location),
  screenLock: false,
  sidePanel: false,
};
