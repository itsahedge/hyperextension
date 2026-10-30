import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { checkAutoLock, idleExpired, onScreenLocked, recordActivity } from "./autolock";
import { DEFAULT_PREFS, loadPrefs, updatePrefs } from "./prefs";
import { lastActiveItem, prefsItem, unlockedItem } from "./storage";

const MIN = 60_000;
const unlocked = {
  config: { address: "0x0000000000000000000000000000000000000001" as const, mode: "master" as const, network: "testnet" as const },
  secrets: { masterKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const },
  hasMasterKey: true,
};

beforeEach(() => fakeBrowser.reset());

describe("idleExpired", () => {
  it("expires at the timeout, not before", () => {
    expect(idleExpired(15 * MIN - 1, 0, 15)).toBe(false);
    expect(idleExpired(15 * MIN, 0, 15)).toBe(true);
  });
  it("never expires when disabled", () => {
    expect(idleExpired(10 ** 12, 0, 0)).toBe(false);
  });
  it("treats missing activity as expired", () => {
    expect(idleExpired(1, null, 15)).toBe(true);
  });
});

describe("prefs", () => {
  it("fills defaults for prefs saved before auto-lock existed", async () => {
    await prefsItem.setValue({ slippage: 0.02 });
    expect(await loadPrefs()).toEqual({ ...DEFAULT_PREFS, slippage: 0.02 });
  });
  it("updates merge instead of replacing", async () => {
    await updatePrefs({ autoLockMinutes: 5 });
    await updatePrefs({ slippage: 0.03 });
    expect(await loadPrefs()).toMatchObject({ autoLockMinutes: 5, slippage: 0.03, lockOnScreenLock: true });
  });
  it("defaults to a 15 minute timeout and screen-lock locking", () => {
    expect(DEFAULT_PREFS).toMatchObject({ autoLockMinutes: 15, lockOnScreenLock: true });
  });
});

describe("checkAutoLock", () => {
  it("locks an idle session and clears its activity stamp", async () => {
    await unlockedItem.setValue(unlocked);
    await recordActivity(0);
    expect(await checkAutoLock(15 * MIN)).toBe(true);
    expect(await unlockedItem.getValue()).toBeNull();
    expect(await lastActiveItem.getValue()).toBeNull();
  });

  it("keeps an active session", async () => {
    await unlockedItem.setValue(unlocked);
    await recordActivity(10 * MIN);
    expect(await checkAutoLock(15 * MIN)).toBe(false);
    expect(await unlockedItem.getValue()).not.toBeNull();
  });

  it("respects the configured timeout and 'never'", async () => {
    await unlockedItem.setValue(unlocked);
    await recordActivity(0);
    await updatePrefs({ autoLockMinutes: 60 });
    expect(await checkAutoLock(30 * MIN)).toBe(false);
    await updatePrefs({ autoLockMinutes: 0 });
    expect(await checkAutoLock(10 ** 9)).toBe(false);
  });

  it("does nothing when already locked", async () => {
    expect(await checkAutoLock(10 ** 9)).toBe(false);
  });
});

describe("onScreenLocked", () => {
  it("locks when enabled", async () => {
    await unlockedItem.setValue(unlocked);
    expect(await onScreenLocked()).toBe(true);
    expect(await unlockedItem.getValue()).toBeNull();
  });
  it("does nothing when disabled", async () => {
    await unlockedItem.setValue(unlocked);
    await updatePrefs({ lockOnScreenLock: false });
    expect(await onScreenLocked()).toBe(false);
    expect(await unlockedItem.getValue()).not.toBeNull();
  });
});
