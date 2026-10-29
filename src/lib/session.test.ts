import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { addressOf, type AccountConfig } from "./account";
import { createVault, loadSession, lock, unlock, updateConfig, updateVault, wipe } from "./session";
import { vaultItem } from "./storage";
import { WrongPasswordError } from "./vault";

// Real PBKDF2 at 600k iterations is slow in tests; keep the cipher, drop the cost.
vi.mock("./vault", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./vault")>();
  return {
    ...mod,
    encryptSecrets: (s: Parameters<typeof mod.encryptSecrets>[0], p: string) => mod.encryptSecrets(s, p, 1_000),
  };
});

// Well-known Anvil/Hardhat development keys. Never fund these.
const MASTER = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const AGENT = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const config: AccountConfig = { address: addressOf(MASTER), mode: "master", network: "testnet" };

beforeEach(() => fakeBrowser.reset());

describe("session lifecycle", () => {
  it("starts empty", async () => {
    expect(await loadSession()).toEqual({ status: "empty" });
  });

  it("create -> unlocked, lock -> locked, unlock -> unlocked", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    expect(await loadSession()).toMatchObject({ status: "unlocked", secrets: { masterKey: MASTER } });

    await lock();
    expect(await loadSession()).toEqual({ status: "locked", config });

    await expect(unlock("nope")).rejects.toBeInstanceOf(WrongPasswordError);
    await unlock("pw");
    expect(await loadSession()).toMatchObject({ status: "unlocked" });
  });

  it("never writes the raw key to local storage", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    const local = JSON.stringify(await fakeBrowser.storage.local.get());
    expect(local).not.toContain(MASTER.slice(2));
  });

  it("refuses a vault without the active mode's key", async () => {
    await expect(createVault({ ...config, mode: "agent" }, { masterKey: MASTER }, "pw")).rejects.toThrow(/agent/);
    expect(await vaultItem.getValue()).toBeNull();
  });

  it("updateVault adds an agent key and switches mode, requiring the password", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    const addAgent = (s: object, c: AccountConfig) => ({
      secrets: { ...s, agentKey: AGENT },
      config: { ...c, mode: "agent" as const },
    });
    await expect(updateVault("wrong", addAgent)).rejects.toBeInstanceOf(WrongPasswordError);

    await updateVault("pw", addAgent);
    await lock();
    await unlock("pw");
    expect(await loadSession()).toMatchObject({
      status: "unlocked",
      config: { mode: "agent" },
      secrets: { masterKey: MASTER, agentKey: AGENT },
    });
  });

  it("updateConfig rejects switching to a mode with no key", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    await expect(updateConfig({ mode: "agent" })).rejects.toThrow(/agent/);
    await updateConfig({ network: "mainnet" });
    expect(await loadSession()).toMatchObject({ config: { network: "mainnet", mode: "master" } });
  });

  it("wipe removes everything", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    await wipe();
    expect(await loadSession()).toEqual({ status: "empty" });
  });
});
