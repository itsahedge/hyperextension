// What differs between the Chrome extension and the web app. Shared code
// imports `platform` from "@/platform"; the extension build resolves it to
// ./index.ts (chrome.storage, extension ID) and the web build aliases it to
// ./web.ts (localStorage and memory, page hostname). See vite.web.config.ts.

// "local:" persists; "session:" is memory-only and holds decrypted keys.
export type StorageKey = `local:${string}` | `session:${string}`;

// The subset of WXT's storage item the app uses.
export interface StorageItem<T> {
  readonly key: StorageKey;
  getValue(): Promise<T>;
  setValue(value: T): Promise<void>;
  removeValue(): Promise<void>;
  // Called after every change, from any context; returns an unsubscribe.
  watch(cb: (next: T, prev: T) => void): () => void;
}

export interface DefineItem {
  <T>(key: StorageKey): StorageItem<T | null>;
  <T>(key: StorageKey, options: { fallback: T }): StorageItem<T>;
}

export interface Platform {
  kind: "extension" | "web";
  defineItem: DefineItem;
  // WebAuthn RP ID: the extension ID, or the web app's hostname.
  passkeyRpId(): string;
  // The web app keeps only an API wallet: it can trade but never withdraw.
  storesMasterKey: boolean;
  // New vaults open with a passkey only, no password (web app). Losing the
  // passkey there costs only an API wallet, which can be replaced.
  passwordless: boolean;
  // helper: the WireGuard helper over native messaging (extension).
  // relay: the Mac mini's tunnel; every API call goes through its relay (web).
  vpn: "helper" | "relay";
  // The URL to call for an API URL: unchanged in the extension (chrome.proxy
  // routes it), the Mac mini's relay on the web (platform/relay.ts).
  route(url: string): string;
  // chrome.idle reports OS screen lock (extension only).
  screenLock: boolean;
  // Side panel button in the popup header (extension only).
  sidePanel: boolean;
}
