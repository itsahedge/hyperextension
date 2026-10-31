import { describe, expect, it, vi } from "vitest";
import { addressOf } from "./account";
import { createVault, loadSession, updateVault } from "./session";
import { vaultItem } from "./storage";

// The web app's platform: memory-backed storage, no master key.
vi.mock("@/platform", async () => {
  const { createWebStorage } = await import("@/platform/webStorage");
  const data = new Map<string, string>();
  const store = createWebStorage({
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  });
  return {
    platform: {
      kind: "web",
      defineItem: store.defineItem,
      passkeyRpId: () => "mini.example.ts.net",
      storesMasterKey: false,
      passwordless: true,
      vpn: "relay",
      route: (url: string) => url,
      screenLock: false,
      sidePanel: false,
    },
  };
});

vi.mock("./vault", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./vault")>();
  return { ...mod, createVault: (s: Parameters<typeof mod.createVault>[0], p: string) => mod.createVault(s, p, 1_000) };
});

const MASTER = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const AGENT = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const address = addressOf(MASTER);
const password = { kind: "password", password: "correct horse" } as const;

describe("session on the web app", () => {
  it("refuses to store a master key", async () => {
    await expect(createVault({ address, mode: "master", network: "testnet" }, { masterKey: MASTER }, "correct horse")).rejects.toThrow(
      /only an API wallet/,
    );
    expect(await vaultItem.getValue()).toBeNull();
  });

  it("stores an API wallet and unlocks with it", async () => {
    await createVault({ address, mode: "agent", network: "testnet" }, { agentKey: AGENT }, "correct horse");
    const session = await loadSession();
    expect(session.status).toBe("unlocked");
    if (session.status === "unlocked") expect(session.secrets).toEqual({ agentKey: AGENT });
  });

  it("refuses to add a master key to the vault later", async () => {
    const before = await vaultItem.getValue();
    await expect(
      updateVault(password, (secrets, config) => ({ secrets: { ...secrets, masterKey: MASTER }, config })),
    ).rejects.toThrow(/only an API wallet/);
    expect(await vaultItem.getValue()).toEqual(before);
  });
});
