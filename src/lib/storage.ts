import { storage } from "#imports";
import type { AccountConfig } from "./account";
import type { Secrets, StoredVault } from "./vault";

export const vaultItem = storage.defineItem<StoredVault>("local:vault");
export const configItem = storage.defineItem<AccountConfig>("local:config");
// chrome.storage.session lives in memory and is cleared when the browser exits,
// so decrypted keys never touch disk. Default access level excludes content scripts.
export const unlockedItem = storage.defineItem<Secrets>("session:secrets");
