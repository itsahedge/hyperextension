import "dotenv/config";
import * as crypto from "crypto";

// Encryption constants
const ALGORITHM = "aes-256-cbc";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 16; // 128 bits
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = "sha512";

const MASTER_KEY = process.env.ENCRYPTION_MASTER_KEY!;
const TURNKEY_DEFAULT_ORGANIZATION_ID = process.env.TURNKEY_ORGANIZATION_ID!;

if (!MASTER_KEY || !TURNKEY_DEFAULT_ORGANIZATION_ID) {
  throw new Error(
    "DATA_ENCRYPTION_KEY or TURNKEY_DEFAULT_ORGANIZATION_ID is not set in the environment variables"
  );
}

/**
 * Decrypts data that was encrypted with AES-256-CBC.
 * @param encryptedData - The encrypted data as a base64 string.
 * @param masterKey - The master key used for encryption.
 * @returns The decrypted data as a UTF-8 string.
 * @throws Error if decryption fails.
 */
export function decryptData(encryptedData: string): string {
  try {
    const combined = Buffer.from(encryptedData, "base64");
    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const encryptedText = combined.subarray(SALT_LENGTH + IV_LENGTH);

    if (!MASTER_KEY) {
      console.error("MASTER_KEY is undefined");
      return "";
    }

    const key = crypto.pbkdf2Sync(
      MASTER_KEY,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      PBKDF2_DIGEST
    );
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString("utf8");
  } catch (error) {
    console.error(
      `Decryption failed: ${
        error instanceof Error ? error.message : "UnknownError"
      }`
    );
    return "";
  }
}

/**
 * Generates a secure salt from a given string and the master key.
 * @param inputString - The input string to generate a salt from.
 * @returns The generated salt as a hexadecimal string.
 */
export function createHashedString(
  inputString: string,
  securedKey: string,
  algorithm: string = "sha256"
): string {
  const combinedString = inputString + securedKey;
  return crypto.createHash(algorithm).update(combinedString).digest("hex");
}
/**
 * Decrypt data using AES with the derived key from the salt.
 * @param encryptedData The encrypted data to decrypt.
 * @param salt The salt to use for key derivation.
 * @returns The decrypted data.
 */
export function aesDecryptDeprecated(
  encryptedData: string,
  salt: string
): string {
  // Derive the key from the salt using PBKDF2
  const key = crypto.pbkdf2Sync(salt, salt, 100000, 32, "sha256");

  let iv: Buffer;
  let encrypted: string;

  // Check if the data is in the old base64 format or the new hex format
  if (isBase64(encryptedData)) {
    // Old format: base64 encoded
    const buffer = Buffer.from(encryptedData, "base64");
    iv = buffer.slice(0, 16);
    encrypted = buffer.slice(16).toString("hex");
  } else {
    // New format: hex encoded
    iv = Buffer.from(encryptedData.slice(0, 32), "hex");
    encrypted = encryptedData.slice(32);
  }

  // Create AES decipher using the key and IV
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);

  // Decrypt the data
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

function aesDecrypt(
  encryptedData: string,
  pwdHash: string,
  salt: string
): string {
  // Derive the key from the salt using PBKDF2
  const key = crypto.pbkdf2Sync(pwdHash, salt, 100000, 32, "sha256");

  let iv: Buffer;
  let encrypted: string;

  // Check if the data is in the old base64 format or the new hex format
  if (isBase64(encryptedData)) {
    // Old format: base64 encoded
    const buffer = Buffer.from(encryptedData, "base64");
    iv = buffer.slice(0, 16);
    encrypted = buffer.slice(16).toString("hex");
  } else {
    // New format: hex encoded
    iv = Buffer.from(encryptedData.slice(0, 32), "hex");
    encrypted = encryptedData.slice(32);
  }

  // Create AES decipher using the key and IV
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);

  // Decrypt the data
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Encrypt data using AES with the derived key from the salt.
 * @param data The data to encrypt.
 * @param salt The salt to use for key derivation.
 * @returns The encrypted data in base64 format with IV prepended.
 */
export function aesEncrypt(
  data: string,
  pwdHash: string,
  salt: string
): string {
  // Derive a key from the salt using PBKDF2
  const key = crypto.pbkdf2Sync(pwdHash, salt, 100000, 32, "sha256");

  // Generate a random initialization vector (IV)
  const iv = crypto.randomBytes(16);

  // Create AES cipher using the key and IV
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);

  // Encrypt the data
  const encryptedBuffer = Buffer.concat([
    cipher.update(Buffer.from(data, "utf8")),
    cipher.final(),
  ]);

  // Combine IV and encrypted data, then convert to base64
  return Buffer.concat([iv, encryptedBuffer]).toString("base64");
}

// Helper function to check if a string is base64 encoded
export function isBase64(str: string): boolean {
  try {
    return Buffer.from(str, "base64").toString("base64") === str;
  } catch {
    return false;
  }
}

/**
 * Generates an encrypted secret using the provided ID and encryption key.
 * @param id - The user ID or other unique identifier.
 * @param encryptKey - The key to be encrypted.
 * @returns The encrypted secret as a base64 string, or null if encryption fails.
 */
export function getSecretDeprecated(
  id: string,
  encryptKey: string
): string | null {
  try {
    const salt = createHashedString(id, MASTER_KEY);
    return aesDecryptDeprecated(encryptKey, salt);
  } catch (error) {
    console.error("Error in getSecret:", error);
    return null;
  }
}

export function getSecret(id: string, encryptKey: string): string | null {
  try {
    const pwdHash = createHashedString(id, TURNKEY_DEFAULT_ORGANIZATION_ID);
    const salt = createHashedString(id, MASTER_KEY);

    return aesDecrypt(encryptKey, pwdHash, salt);
  } catch (error) {
    console.error("Error in getSecret:", error);
    return null;
  }
}

/** COPIED FROM bot-login-backend (secretManager.ts)
 * Encrypts a string using AES-256-CBC with a unique salt and IV for each encryption.
 * @param text - The string to encrypt.
 * @param masterKey - The master key for deriving encryption keys.
 * @returns An object containing the combined encrypted data, IV, and salt in base64 format.
 */
// Source: bot-login-backend (file: secretManager.ts)
export function encryptData(text: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  const key = crypto.pbkdf2Sync(MASTER_KEY, salt, 100000, KEY_LENGTH, "sha512");

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");

  // Combine salt, IV, and encrypted data
  const combined = Buffer.concat([salt, iv, Buffer.from(encrypted, "base64")]);

  return combined.toString("base64");
}

// Source: bot-login-backend (file: secretManager.ts)
export function createOrUpdateSecret(id: string, privateKey: string): string {
  const salt = createSecureSalt(id, MASTER_KEY);

  const pwdHash = createSecureSalt(id, TURNKEY_DEFAULT_ORGANIZATION_ID);

  return aesEncrypt(privateKey, pwdHash, salt);
}

// Source: bot-login-backend (file: secretManager.ts)
function createSecureSalt(inputString: string, privateKey: string): string {
  if (!privateKey) {
    throw new Error("privateKey is not set in the environment variables");
  }

  // Combine the input string with the private key
  const combinedString = inputString + privateKey;

  // Create a SHA-256 hash of the combined string
  return crypto.createHash("sha256").update(combinedString).digest("hex");
}
