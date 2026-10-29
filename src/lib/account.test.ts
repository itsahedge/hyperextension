import { describe, expect, it } from "vitest";
import { addressOf, parseAddress, parsePrivateKey, signerKey, trySignerKey, validateAccount, type AccountConfig } from "./account";

// Well-known Anvil/Hardhat development keys. Never fund these.
const MASTER = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const AGENT = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const masterAddress = addressOf(MASTER);

const config = (mode: AccountConfig["mode"]): AccountConfig => ({
  address: masterAddress,
  mode,
  network: "testnet",
});

describe("parsePrivateKey", () => {
  it("accepts keys with or without 0x and trims whitespace", () => {
    expect(parsePrivateKey(` ${MASTER.slice(2)}\n`)).toBe(MASTER);
    expect(parsePrivateKey(MASTER)).toBe(MASTER);
  });

  it("rejects wrong length or non-hex", () => {
    expect(() => parsePrivateKey("0x1234")).toThrow();
    expect(() => parsePrivateKey(`0x${"z".repeat(64)}`)).toThrow();
  });
});

describe("parseAddress", () => {
  it("rejects garbage", () => {
    expect(() => parseAddress("0xnotanaddress")).toThrow();
  });
  it("accepts a valid address", () => {
    expect(parseAddress(` ${masterAddress} `)).toBe(masterAddress);
  });
});

describe("signerKey", () => {
  it("picks the key for the active mode", () => {
    const secrets = { masterKey: MASTER, agentKey: AGENT };
    expect(signerKey(config("master"), secrets)).toBe(MASTER);
    expect(signerKey(config("agent"), secrets)).toBe(AGENT);
  });

  it("throws when the active mode has no key", () => {
    expect(() => signerKey(config("agent"), { masterKey: MASTER })).toThrow(/agent/);
  });
});

describe("trySignerKey", () => {
  it("returns null instead of throwing when the mode's key is missing", () => {
    expect(trySignerKey(config("agent"), { masterKey: MASTER })).toBeNull();
    expect(trySignerKey(config("master"), { masterKey: MASTER })).toBe(MASTER);
  });
});

describe("validateAccount", () => {
  it("accepts agent-only vaults", () => {
    expect(() => validateAccount(config("agent"), { agentKey: AGENT })).not.toThrow();
  });

  it("rejects a master key for a different account", () => {
    expect(() =>
      validateAccount({ ...config("master"), address: addressOf(AGENT) }, { masterKey: MASTER }),
    ).toThrow(/does not match/);
  });

  it("rejects using the master key as the agent key", () => {
    expect(() => validateAccount(config("agent"), { agentKey: MASTER })).toThrow(/own key/);
  });
});
