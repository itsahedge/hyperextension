import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { addressOf, signerKey, type AccountConfig } from "./account";
import {
  createVault,
  deriveSession,
  enrollPasskey,
  loadSession,
  lock,
  removePasskey,
  unlock,
  updateConfig,
  setSigningMode,
  updateVault,
  withMasterKey,
  wipe,
  type SessionState,
} from "./session";
import { configItem, unlockedItem, vaultItem } from "./storage";
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

  it("updateVault via passkey keeps password and passkey slots valid", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    await enrollPasskey(pw("pw"), "Touch ID");
    await updateVault(passkey, (s, c) => ({ secrets: { ...s, agentKey: AGENT }, config: { ...c, mode: "agent" } }));
    for (const auth of [passkey, pw("pw")]) {
      await lock();
      await unlock(auth);
      expect(await loadSession()).toMatchObject({ config: { mode: "agent" }, secrets: { agentKey: AGENT }, hasMasterKey: true });
      // Sealed in the vault, not in the session, in API-wallet mode.
      expect(await withMasterKey(auth, async (k) => k)).toBe(MASTER);
    }
  });
});

// The popup re-derives session state on every storage change. Every state it
// can observe mid-update must be self-consistent: if unlocked, the active
// mode's key is present. fake-browser awaits onChanged listeners inside each
// write, so this captures each intermediate state, not just the final one.
async function statesDuring(run: () => Promise<unknown>) {
  const states: SessionState[] = [];
  const read = (item: { key: string }, area: Record<string, unknown>) =>
    (area[item.key.slice(item.key.indexOf(":") + 1)] ?? null) as never;
  const listener = async () => {
    const [local, session] = await Promise.all([fakeBrowser.storage.local.get(), fakeBrowser.storage.session.get()]);
    states.push(deriveSession(read(vaultItem, local), read(configItem, local), read(unlockedItem, session)));
  };
  fakeBrowser.storage.onChanged.addListener(listener);
  try {
    await run();
  } finally {
    fakeBrowser.storage.onChanged.removeListener(listener);
  }
  return states;
}

function expectConsistent(states: SessionState[]) {
  expect(states.length).toBeGreaterThan(0);
  for (const s of states) {
    if (s.status === "unlocked") expect(() => signerKey(s.config, s.secrets)).not.toThrow();
  }
}

describe("mode switches are never observed half-applied", () => {
  it("adding an API wallet key and switching to agent mode", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    expectConsistent(
      await statesDuring(() =>
        updateVault(pw("pw"), (s, c) => ({ secrets: { ...s, agentKey: AGENT }, config: { ...c, mode: "agent" } })),
      ),
    );
  });

  it("removing the master key while switching to agent mode", async () => {
    await createVault(config, { masterKey: MASTER, agentKey: AGENT }, "pw");
    expectConsistent(
      await statesDuring(() =>
        updateVault(pw("pw"), (s, c) => ({ secrets: { agentKey: s.agentKey }, config: { ...c, mode: "agent" } })),
      ),
    );
  });

  it("toggling mode from settings", async () => {
    await createVault(config, { masterKey: MASTER, agentKey: AGENT }, "pw");
    expectConsistent(await statesDuring(() => updateConfig({ mode: "agent" })));
    expectConsistent(await statesDuring(() => setSigningMode(pw("pw"), "master")));
  });
});

describe("master key exposure in API-wallet mode", () => {
  const sessionJson = async () => JSON.stringify(await fakeBrowser.storage.session.get());
  const both = { masterKey: MASTER, agentKey: AGENT };
  const agentConfig = { ...config, mode: "agent" as const };

  it("keeps the master key out of session storage while trading with the API wallet", async () => {
    await createVault(agentConfig, both, "pw");
    expect(await sessionJson()).not.toContain(MASTER.slice(2));
    expect(await loadSession()).toMatchObject({ status: "unlocked", hasMasterKey: true, secrets: { agentKey: AGENT } });

    await lock();
    await unlock(pw("pw"));
    expect(await sessionJson()).not.toContain(MASTER.slice(2));

    await updateVault(pw("pw"), (s, c) => ({ secrets: { ...s, vpnConf: "x" }, config: c }));
    expect(await sessionJson()).not.toContain(MASTER.slice(2));
    expect(await loadSession()).toMatchObject({ hasMasterKey: true, secrets: { agentKey: AGENT, vpnConf: "x" } });
  });

  it("holds the master key in master mode, where it is the signer", async () => {
    await createVault(config, both, "pw");
    expect(await loadSession()).toMatchObject({ hasMasterKey: true, secrets: { masterKey: MASTER } });
    await updateConfig({ mode: "agent" });
    expect(await sessionJson()).not.toContain(MASTER.slice(2));
  });

  it("withMasterKey hands out the key only after auth", async () => {
    await createVault(agentConfig, both, "pw");
    const use = vi.fn(async (key: string) => key);
    await expect(withMasterKey(pw("wrong"), use)).rejects.toBeInstanceOf(WrongPasswordError);
    expect(use).not.toHaveBeenCalled();
    expect(await withMasterKey(pw("pw"), use)).toBe(MASTER);
    await enrollPasskey(pw("pw"), "Touch ID");
    expect(await withMasterKey(passkey, use)).toBe(MASTER);
  });

  it("withMasterKey refuses when no master key is stored", async () => {
    await createVault({ ...agentConfig, address: addressOf(MASTER) }, { agentKey: AGENT }, "pw");
    await expect(withMasterKey(pw("pw"), async () => "x")).rejects.toThrow(/master key/);
  });

  it("switching to master mode needs auth, since it loads the key into the session", async () => {
    await createVault(agentConfig, both, "pw");
    await expect(updateConfig({ mode: "master" })).rejects.toThrow(/passkey or password/);
    await expect(setSigningMode(pw("wrong"), "master")).rejects.toBeInstanceOf(WrongPasswordError);
    await setSigningMode(pw("pw"), "master");
    expect(await loadSession()).toMatchObject({ config: { mode: "master" }, secrets: { masterKey: MASTER } });
  });
});

describe("withdrawal allowlist in the vault", () => {
  const COLD = "0x2222222222222222222222222222222222222222" as const;
  const add = (s: { withdrawAllowlist?: unknown[] }, c: AccountConfig) => ({
    secrets: { ...s, withdrawAllowlist: [{ address: COLD, label: "Cold", addedAt: 1 }] },
    config: c,
  });

  it("changes only with valid auth and survives lock/unlock sealed", async () => {
    await createVault(config, { masterKey: MASTER }, "pw");
    await expect(updateVault(pw("wrong"), add)).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await loadSession()).toMatchObject({ secrets: { masterKey: MASTER } });
    expect((await loadSession()) as { secrets: object }).not.toHaveProperty("secrets.withdrawAllowlist");

    await updateVault(pw("pw"), add);
    await lock();
    expect(JSON.stringify(await fakeBrowser.storage.local.get())).not.toContain(COLD.slice(2));
    await unlock(pw("pw"));
    expect(await loadSession()).toMatchObject({ secrets: { withdrawAllowlist: [{ address: COLD, label: "Cold" }] } });
  });
});

describe("activity stamp", () => {
  // An auto-lock check sees "unlocked with no activity" as expired, so the
  // stamp must land before the keys on every path that unlocks.
  async function unlockedWithoutStamp(run: () => Promise<unknown>) {
    const violations: string[] = [];
    const listener = async () => {
      const session = await fakeBrowser.storage.session.get();
      if (session.unlocked && session.lastActive === undefined) violations.push("unlocked before lastActive");
    };
    fakeBrowser.storage.onChanged.addListener(listener);
    try {
      await run();
    } finally {
      fakeBrowser.storage.onChanged.removeListener(listener);
    }
    return violations;
  }

  it("is recorded before the keys on create and unlock, and cleared on lock", async () => {
    expect(await unlockedWithoutStamp(() => createVault(config, { masterKey: MASTER }, "pw"))).toEqual([]);
    await lock();
    expect(await fakeBrowser.storage.session.get()).toEqual({});
    expect(await unlockedWithoutStamp(() => unlock(pw("pw")))).toEqual([]);
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
