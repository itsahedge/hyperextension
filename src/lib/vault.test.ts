import { describe, expect, it } from "vitest";
import { decryptSecrets, encryptSecrets, WrongPasswordError, type Secrets } from "./vault";

// Low iteration count keeps tests fast; production uses PBKDF2_ITERATIONS.
const FAST = 1_000;
const secrets: Secrets = {
  masterKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  agentKey: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
};

describe("vault", () => {
  it("round-trips secrets with the right password", async () => {
    const vault = await encryptSecrets(secrets, "correct horse", FAST);
    expect(await decryptSecrets(vault, "correct horse")).toEqual(secrets);
  });

  it("rejects a wrong password", async () => {
    const vault = await encryptSecrets(secrets, "correct horse", FAST);
    await expect(decryptSecrets(vault, "wrong")).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("does not store plaintext and uses fresh salt and iv per encryption", async () => {
    const a = await encryptSecrets(secrets, "pw", FAST);
    const b = await encryptSecrets(secrets, "pw", FAST);
    expect(JSON.stringify(a)).not.toContain(secrets.masterKey!.slice(2));
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("detects tampered ciphertext", async () => {
    const vault = await encryptSecrets(secrets, "pw", FAST);
    const bytes = atob(vault.ciphertext).split("");
    bytes[0] = String.fromCharCode(bytes[0]!.charCodeAt(0) ^ 1);
    await expect(
      decryptSecrets({ ...vault, ciphertext: btoa(bytes.join("")) }, "pw"),
    ).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("records the iteration count used", async () => {
    const vault = await encryptSecrets({}, "pw", FAST);
    expect(vault.iterations).toBe(FAST);
    expect(vault.version).toBe(1);
  });
});
