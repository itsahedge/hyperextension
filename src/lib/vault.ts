import type { Hex } from "viem";
import type { AllowedAddress } from "./withdraw";

// Everything sealed in the vault. The allowlist is not secret, but sealing it
// means only an authorized updateVault can change it.
export interface Secrets {
  masterKey?: Hex;
  agentKey?: Hex;
  withdrawAllowlist?: AllowedAddress[];
}

// Envelope layout (v2):
//
//   secrets ──AES-GCM(DEK)──▶ data
//   DEK ──AES-GCM(PBKDF2(password))──────▶ password slot   (always present: recovery)
//   DEK ──AES-GCM(HKDF(passkey PRF out))─▶ passkey slot(s) (optional)
//
// Any slot recovers the same random DEK, so adding or removing a passkey never
// re-encrypts the secrets, and the password keeps working if a passkey is lost.

interface Sealed {
  iv: string;
  ciphertext: string;
}

export interface PasswordSlot {
  iterations: number;
  salt: string;
  wrapped: Sealed;
}

export interface PasskeySlot {
  // base64url, as used by WebAuthn evalByCredential keys.
  credentialId: string;
  // PRF input; random per slot so outputs are unique to this vault.
  prfSalt: string;
  label: string;
  createdAt: number;
  wrapped: Sealed;
}

export interface VaultV2 {
  version: 2;
  data: Sealed;
  password: PasswordSlot;
  passkeys: PasskeySlot[];
}

export interface VaultV1 {
  version: 1;
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

export type StoredVault = VaultV1 | VaultV2;

// Raw 256-bit data encryption key. Never persisted unwrapped.
export type DataKey = Uint8Array<ArrayBuffer>;

// OWASP Password Storage Cheat Sheet: PBKDF2-HMAC-SHA256, 600,000 iterations.
export const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12; // AES-GCM standard nonce length
const DEK_BYTES = 32;
// Domain-separates the HKDF output from any other use of the PRF secret.
const PASSKEY_HKDF_INFO = new TextEncoder().encode("hyperextension vault v2 passkey wrap");

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong password");
    this.name = "WrongPasswordError";
  }
}

export class PasskeyMismatchError extends Error {
  constructor() {
    super("This passkey cannot unlock the vault");
    this.name = "PasskeyMismatchError";
  }
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function createVault(
  secrets: Secrets,
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<{ vault: VaultV2; dek: DataKey }> {
  const dek = randomBytes(DEK_BYTES);
  const vault: VaultV2 = {
    version: 2,
    data: await seal(await aesKey(dek), encodeJson(secrets)),
    password: await passwordSlot(dek, password, iterations),
    passkeys: [],
  };
  return { vault, dek };
}

export async function unwrapWithPassword(vault: VaultV2, password: string): Promise<DataKey> {
  const { salt, iterations, wrapped } = vault.password;
  const key = await pbkdf2Key(password, fromBase64(salt), iterations);
  return openOr(key, wrapped, () => new WrongPasswordError());
}

export async function unwrapWithPrf(slot: PasskeySlot, prfOutput: Uint8Array<ArrayBuffer>): Promise<DataKey> {
  return openOr(await hkdfKey(prfOutput), slot.wrapped, () => new PasskeyMismatchError());
}

export async function openSecrets(vault: VaultV2, dek: DataKey): Promise<Secrets> {
  const plaintext = await openOr(await aesKey(dek), vault.data, () => new Error("Vault data is corrupted"));
  return JSON.parse(new TextDecoder().decode(plaintext)) as Secrets;
}

export async function sealSecrets(vault: VaultV2, dek: DataKey, secrets: Secrets): Promise<VaultV2> {
  return { ...vault, data: await seal(await aesKey(dek), encodeJson(secrets)) };
}

export async function addPasskeySlot(
  vault: VaultV2,
  dek: DataKey,
  passkey: { credentialId: string; prfSalt: Uint8Array; label: string; prfOutput: Uint8Array<ArrayBuffer> },
): Promise<VaultV2> {
  const slot: PasskeySlot = {
    credentialId: passkey.credentialId,
    prfSalt: toBase64(passkey.prfSalt),
    label: passkey.label,
    createdAt: Date.now(),
    wrapped: await seal(await hkdfKey(passkey.prfOutput), dek),
  };
  return { ...vault, passkeys: [...vault.passkeys.filter((p) => p.credentialId !== slot.credentialId), slot] };
}

export function removePasskeySlot(vault: VaultV2, credentialId: string): VaultV2 {
  return { ...vault, passkeys: vault.passkeys.filter((p) => p.credentialId !== credentialId) };
}

export function passkeySalt(slot: PasskeySlot): Uint8Array<ArrayBuffer> {
  return fromBase64(slot.prfSalt);
}

// v1 encrypted the secrets directly with the password-derived key.
export async function migrateV1(
  v1: VaultV1,
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<{ vault: VaultV2; dek: DataKey; secrets: Secrets }> {
  const key = await pbkdf2Key(password, fromBase64(v1.salt), v1.iterations);
  const plaintext = await openOr(key, { iv: v1.iv, ciphertext: v1.ciphertext }, () => new WrongPasswordError());
  const secrets = JSON.parse(new TextDecoder().decode(plaintext)) as Secrets;
  const { vault, dek } = await createVault(secrets, password, iterations);
  return { vault, dek, secrets };
}

async function passwordSlot(dek: DataKey, password: string, iterations: number): Promise<PasswordSlot> {
  const salt = randomBytes(SALT_BYTES);
  return {
    iterations,
    salt: toBase64(salt),
    wrapped: await seal(await pbkdf2Key(password, salt, iterations), dek),
  };
}

async function seal(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

// AES-GCM authentication failure means the key is wrong (or data was tampered).
async function openOr(key: CryptoKey, sealed: Sealed, fail: () => Error): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(sealed.iv) },
      key,
      fromBase64(sealed.ciphertext),
    );
    return new Uint8Array(plaintext);
  } catch {
    throw fail();
  }
}

function aesKey(raw: DataKey) {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function pbkdf2Key(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function hkdfKey(prfOutput: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: PASSKEY_HKDF_INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const encodeJson = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
