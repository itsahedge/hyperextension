import { describe, expect, it } from "vitest";
import {
  addPasskeySlot,
  createPasskeyVault,
  createVault,
  fromBase64,
  migrateV1,
  openSecrets,
  PasskeyMismatchError,
  passkeySalt,
  randomBytes,
  removePasskeySlot,
  sealSecrets,
  toBase64,
  unwrapWithPassword,
  unwrapWithPrf,
  WrongPasswordError,
  type Secrets,
  type VaultV1,
} from "./vault";

// Low iteration count keeps tests fast; production uses PBKDF2_ITERATIONS.
const FAST = 1_000;
// Well-known Anvil/Hardhat development keys. Never fund these.
const secrets: Secrets = {
  masterKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  agentKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
};

const passkey = (credentialId: string) => ({
  credentialId,
  prfSalt: randomBytes(32),
  label: credentialId,
  prfOutput: randomBytes(32),
});

describe("password slot", () => {
  it("round-trips secrets with the right password", async () => {
    const { vault } = await createVault(secrets, "correct horse", FAST);
    const dek = await unwrapWithPassword(vault, "correct horse");
    expect(await openSecrets(vault, dek)).toEqual(secrets);
  });

  it("rejects a wrong password", async () => {
    const { vault } = await createVault(secrets, "correct horse", FAST);
    await expect(unwrapWithPassword(vault, "wrong")).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("stores no plaintext and uses fresh randomness per vault", async () => {
    const a = await createVault(secrets, "pw", FAST);
    const b = await createVault(secrets, "pw", FAST);
    expect(JSON.stringify(a.vault)).not.toContain(secrets.masterKey!.slice(2));
    expect(a.vault.password!.salt).not.toBe(b.vault.password!.salt);
    expect(a.vault.data.ciphertext).not.toBe(b.vault.data.ciphertext);
    expect(toBase64(a.dek)).not.toBe(toBase64(b.dek));
  });

  it("detects tampered data", async () => {
    const { vault, dek } = await createVault(secrets, "pw", FAST);
    const bytes = fromBase64(vault.data.ciphertext);
    bytes[0]! ^= 1;
    await expect(openSecrets({ ...vault, data: { ...vault.data, ciphertext: toBase64(bytes) } }, dek)).rejects.toThrow(
      /corrupted/,
    );
  });
});

describe("passkey slots", () => {
  it("unwraps the same DEK as the password", async () => {
    const { vault, dek } = await createVault(secrets, "pw", FAST);
    const pk = passkey("cred-a");
    const withPasskey = await addPasskeySlot(vault, dek, pk);
    const slot = withPasskey.passkeys[0]!;
    expect(toBase64(await unwrapWithPrf(slot, pk.prfOutput))).toBe(toBase64(dek));
    expect(passkeySalt(slot)).toEqual(pk.prfSalt);
    expect(await openSecrets(withPasskey, await unwrapWithPassword(withPasskey, "pw"))).toEqual(secrets);
  });

  it("rejects a different PRF output", async () => {
    const { vault, dek } = await createVault(secrets, "pw", FAST);
    const withPasskey = await addPasskeySlot(vault, dek, passkey("cred-a"));
    await expect(unwrapWithPrf(withPasskey.passkeys[0]!, randomBytes(32))).rejects.toBeInstanceOf(PasskeyMismatchError);
  });

  it("replaces a slot with the same credential id and removes by id", async () => {
    const { vault, dek } = await createVault(secrets, "pw", FAST);
    let v = await addPasskeySlot(vault, dek, passkey("cred-a"));
    v = await addPasskeySlot(v, dek, passkey("cred-b"));
    v = await addPasskeySlot(v, dek, passkey("cred-a"));
    expect(v.passkeys.map((p) => p.credentialId)).toEqual(["cred-b", "cred-a"]);
    expect(removePasskeySlot(v, "cred-b").passkeys.map((p) => p.credentialId)).toEqual(["cred-a"]);
  });

  it("re-sealing secrets keeps every slot valid", async () => {
    const { vault, dek } = await createVault(secrets, "pw", FAST);
    const pk = passkey("cred-a");
    let v = await addPasskeySlot(vault, dek, pk);
    v = await sealSecrets(v, dek, { agentKey: secrets.agentKey });
    expect(await openSecrets(v, await unwrapWithPrf(v.passkeys[0]!, pk.prfOutput))).toEqual({ agentKey: secrets.agentKey });
    expect(await openSecrets(v, await unwrapWithPassword(v, "pw"))).toEqual({ agentKey: secrets.agentKey });
  });
});

describe("passkey-only vault", () => {
  const agentOnly: Secrets = { agentKey: secrets.agentKey };

  it("opens with its passkey and has no password slot", async () => {
    const pk = passkey("cred-a");
    const { vault, dek } = await createPasskeyVault(agentOnly, pk);
    expect(vault.password).toBeNull();
    expect(vault.passkeys.map((p) => p.credentialId)).toEqual(["cred-a"]);
    expect(toBase64(await unwrapWithPrf(vault.passkeys[0]!, pk.prfOutput))).toBe(toBase64(dek));
    expect(await openSecrets(vault, dek)).toEqual(agentOnly);
  });

  it("refuses a password", async () => {
    const { vault } = await createPasskeyVault(agentOnly, passkey("cred-a"));
    await expect(unwrapWithPassword(vault, "anything")).rejects.toThrow(/no password/);
  });

  it("refuses to remove its last passkey, which is the only way to unlock it", async () => {
    const { vault, dek } = await createPasskeyVault(agentOnly, passkey("cred-a"));
    expect(() => removePasskeySlot(vault, "cred-a")).toThrow(/only passkey/);
    const two = await addPasskeySlot(vault, dek, passkey("cred-b"));
    expect(removePasskeySlot(two, "cred-a").passkeys.map((p) => p.credentialId)).toEqual(["cred-b"]);
  });

  it("removing the last passkey is fine while a password remains", async () => {
    const { vault, dek } = await createVault(secrets, "pw", FAST);
    const v = await addPasskeySlot(vault, dek, passkey("cred-a"));
    expect(removePasskeySlot(v, "cred-a").passkeys).toEqual([]);
  });
});

describe("migrateV1", () => {
  // Builds a v1 vault exactly as the v1 code did: secrets sealed directly
  // under PBKDF2(password).
  async function v1Vault(password: string): Promise<VaultV1> {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: FAST },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(secrets)));
    return { version: 1, iterations: FAST, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ct)) };
  }

  it("converts to v2 that opens with the same password", async () => {
    const { vault, secrets: recovered } = await migrateV1(await v1Vault("pw"), "pw", FAST);
    expect(recovered).toEqual(secrets);
    expect(vault.version).toBe(2);
    expect(await openSecrets(vault, await unwrapWithPassword(vault, "pw"))).toEqual(secrets);
  });

  it("rejects a wrong password", async () => {
    await expect(migrateV1(await v1Vault("pw"), "nope", FAST)).rejects.toBeInstanceOf(WrongPasswordError);
  });
});
