import type { Hex } from "viem";

export interface Secrets {
  masterKey?: Hex;
  agentKey?: Hex;
}

export interface EncryptedVault {
  version: 1;
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

// OWASP Password Storage Cheat Sheet: PBKDF2-HMAC-SHA256, 600,000 iterations.
export const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12; // AES-GCM standard nonce length

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong password");
    this.name = "WrongPasswordError";
  }
}

export async function encryptSecrets(
  secrets: Secrets,
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<EncryptedVault> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, iterations);
  const plaintext = new TextEncoder().encode(JSON.stringify(secrets));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    version: 1,
    iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptSecrets(vault: EncryptedVault, password: string): Promise<Secrets> {
  const key = await deriveKey(password, fromBase64(vault.salt), vault.iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(vault.iv) },
      key,
      fromBase64(vault.ciphertext),
    );
  } catch {
    // AES-GCM authentication failure: the derived key does not match.
    throw new WrongPasswordError();
  }
  return JSON.parse(new TextDecoder().decode(plaintext)) as Secrets;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
