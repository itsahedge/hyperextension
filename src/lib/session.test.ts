import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { addressOf, type AccountConfig } from "./account";
import { createVault, enrollPasskey, loadSession, lock, removePasskey, unlock, updateConfig, updateVault, verify, wipe } from "./session";
import { vaultItem } from "./storage";
import { PasskeyMismatchError, randomBytes, toBase64, WrongPasswordError, type VaultV1 } from "./vault";

// Real PBKDF2 at 600k iterations is slow in tests; keep the cipher, drop the cost.
vi.mock("./vault", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./vault")>();
  return {
    ...mod,
    createVault: (s: Parameters<typeof mod.createVault>[0], p: string) => mod.createVault(s, p, 1_000),
    migrateV1: (v: Parameters<typeof mod.migrateV1>[0], p: string) => mod.migrateV1(v, p, 1_000),
  };
});

// Fake authenticator: each credential has a secret, and PRF(salt) is
// HMAC-SHA256(secret, salt), so outputs are stable per credential and salt.
const authenticator = vi.hoisted(() => ({
  credentials: new Map<string, Uint8Array<ArrayBuffer>>(),
  // Which enrolled credential the "user" picks at the next prompt.
  choose: null as string | null,
  nextId: 0,
}));

async function prf(secret: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, salt));
}

vi.mock("./passkey", () => ({
  createPasskey: async () => {
    const credentialId = `cred-${authenticator.nextId++}`;
    const secret = crypto.getRandomValues(new Uint8Array(32));
    authenticator.credentials.set(credentialId, secret);
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    return { credentialId, prfSalt, prfOutput: await prf(secret, prfSalt) };
  },
  assertPasskey: async (allowed: { credentialId: string; prfSalt: Uint8Array<ArrayBuffer> }[]) => {
    const pick = allowed.find((a) => a.credentialId === authenticator.choose) ?? allowed[0];
    if (!pick) throw new Error("No passkeys enrolled");
    const secret = authenticator.credentials.get(pick.credentialId)!;
    return { credentialId: pick.credentialId, prfOutput: await prf(secret, pick.prfSalt) };
  },
}));

// Well-known Anvil/Hardhat development keys. Never fund these.
const MASTER = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const AGENT = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const config: AccountConfig = { address: addressOf(MASTER), mode: "master", network: "testnet" };
const pw = (password: string) => ({ kind: "password" as const, password });
const passkey = { kind: "passkey" as const };

beforeEach(() => {
  fakeBrowser.reset();
  authenticator.credentials.clear();
  authenticator.choose = null;
});

describe("session lifecycle", () => {
  it("starts empty", async () => {
    expect(await loadSession()).toEqual({ status: "empty" });
  });

  it("create -> unlocked, lock -> locked, unlock -> unlocked", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    expect(await loadSession()).toMatchObject({ status: "unlocked", secrets: { masterKey: MASTER }, passkeys: [] });

    await lock();
    expect(await loadSession()).toEqual({ status: "locked", config, passkeys: [] });

    await expect(unlock(pw("nope"))).rejects.toBeInstanceOf(WrongPasswordError);
    await unlock(pw("pw"));
    expect(await loadSession()).toMatchObject({ status: "unlocked" });
  });

  it("never writes the raw key to local storage", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    await enrollPasskey(pw("pw"), "Touch ID");
    const local = JSON.stringify(await fakeBrowser.storage.local.get());
    expect(local).not.toContain(MASTER.slice(2));
  });

  it("refuses a vault without the active mode's key", async () => {
    await expect(createVault({ ...config, mode: "agent" }, { masterKey: MASTER }, "pw")).rejects.toThrow(/agent/);
    expect(await vaultItem.getValue()).toBeNull();
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

describe("passkeys", () => {
  it("enrolled passkey unlocks; password still works as recovery", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    await enrollPasskey(pw("pw"), "Touch ID");
    await lock();
    expect(await loadSession()).toMatchObject({ status: "locked", passkeys: [{ label: "Touch ID" }] });

    await unlock(passkey);
    expect(await loadSession()).toMatchObject({ status: "unlocked", secrets: { masterKey: MASTER } });

    await lock();
    await unlock(pw("pw"));
    expect(await loadSession()).toMatchObject({ status: "unlocked" });
  });

  it("enrolling requires valid auth", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    await expect(enrollPasskey(pw("wrong"), "x")).rejects.toBeInstanceOf(WrongPasswordError);
    expect(authenticator.credentials.size).toBe(0);
  });

  it("a credential whose PRF output does not match is rejected", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    await enrollPasskey(pw("pw"), "Touch ID");
    // Simulate the authenticator returning a different secret for the same credential.
    authenticator.credentials.set("cred-" + (authenticator.nextId - 1), randomBytes(32));
    await lock();
    await expect(unlock(passkey)).rejects.toBeInstanceOf(PasskeyMismatchError);
  });

  it("supports multiple passkeys and removal", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    await enrollPasskey(pw("pw"), "Mac");
    await enrollPasskey(passkey, "Phone");
    const state = await loadSession();
    if (state.status !== "unlocked") throw new Error("expected unlocked");
    const [mac, phone] = state.passkeys;
    expect(state.passkeys.map((p) => p.label)).toEqual(["Mac", "Phone"]);

    authenticator.choose = phone!.credentialId;
    await lock();
    await unlock(passkey);

    await removePasskey(pw("pw"), mac!.credentialId);
    expect(await loadSession()).toMatchObject({ passkeys: [{ label: "Phone" }] });
  });

  it("verify accepts a passkey or password and rejects a wrong password", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    await enrollPasskey(pw("pw"), "Touch ID");
    await expect(verify(passkey)).resolves.toBeUndefined();
    await expect(verify(pw("pw"))).resolves.toBeUndefined();
    await expect(verify(pw("bad"))).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("updateVault via passkey keeps password and passkey slots valid", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    await enrollPasskey(pw("pw"), "Touch ID");
    await updateVault(passkey, (s, c) => ({ secrets: { ...s, agentKey: AGENT }, config: { ...c, mode: "agent" } }));
    for (const auth of [passkey, pw("pw")]) {
      await lock();
      await unlock(auth);
      expect(await loadSession()).toMatchObject({
        config: { mode: "agent" },
        secrets: { masterKey: MASTER, agentKey: AGENT },
      });
    }
  });
});

describe("updateVault ordering", () => {
  it("runs the change only after auth succeeds, and writes nothing if it throws", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    const onChain = vi.fn(async () => {});
    await expect(
      updateVault(pw("wrong"), async (s, c) => {
        await onChain();
        return { secrets: s, config: c };
      }),
    ).rejects.toBeInstanceOf(WrongPasswordError);
    expect(onChain).not.toHaveBeenCalled();

    const before = JSON.stringify(await vaultItem.getValue());
    await expect(
      updateVault(pw("pw"), async () => {
        throw new Error("approveAgent rejected");
      }),
    ).rejects.toThrow(/rejected/);
    expect(JSON.stringify(await vaultItem.getValue())).toBe(before);
  });
});

describe("v1 migration", () => {
  async function seedV1(password: string) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 1_000 },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify({ masterKey: MASTER })));
    const v1: VaultV1 = { version: 1, iterations: 1_000, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ct)) };
    await fakeBrowser.storage.local.set({ vault: v1, config });
  }

  it("upgrades on password unlock and then accepts passkey enrollment", async () => {
    await seedV1("pw");
    await expect(unlock(passkey)).rejects.toThrow(/password first/);
    await unlock(pw("pw"));
    expect((await vaultItem.getValue())?.version).toBe(2);
    await enrollPasskey(pw("pw"), "Touch ID");
    await lock();
    await unlock(passkey);
    expect(await loadSession()).toMatchObject({ status: "unlocked", secrets: { masterKey: MASTER } });
  });
});
