import { platform } from "@/platform";
import { randomBytes } from "./vault";

// WebAuthn PRF extension shapes (WebAuthn Level 3 §10.1.4). Declared locally
// because TypeScript's bundled DOM lib does not reliably include them.
interface PrfValues {
  first: BufferSource;
}
interface PrfOutputs {
  results?: { first: ArrayBuffer };
}

export class PasskeyUnsupportedError extends Error {
  constructor() {
    super("This passkey provider does not support the PRF extension needed for encryption. Use iCloud Keychain or Google Password Manager.");
    this.name = "PasskeyUnsupportedError";
  }
}

export interface PasskeyRef {
  credentialId: string;
  prfSalt: Uint8Array<ArrayBuffer>;
}

// Chrome lets an extension use its own ID as the RP ID; the credential is then
// scoped to the chrome-extension:// origin. The manifest `key` keeps the ID
// stable. The web app uses its hostname, so its passkeys are separate.
const rpId = () => platform.passkeyRpId();

export async function createPasskey(label: string): Promise<PasskeyRef & { prfOutput: Uint8Array<ArrayBuffer> }> {
  const prfSalt = randomBytes(32);
  const credential = await call(() =>
    navigator.credentials.create({
      publicKey: {
        rp: { id: rpId(), name: "Hyperextension" },
        user: { id: randomBytes(16), name: label, displayName: label },
        // No server verifies this assertion; security comes from the PRF secret.
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
      },
    }),
  );
  const prf = (credential.getClientExtensionResults() as { prf?: PrfOutputs }).prf;
  const credentialId = toBase64Url(new Uint8Array(credential.rawId));
  // `enabled: false` only means no PRF output at creation; many providers
  // evaluate PRF on assertion only, and assertPasskey throws if they cannot.
  const prfOutput = prf?.results
    ? new Uint8Array(prf.results.first)
    : (await assertPasskey([{ credentialId, prfSalt }])).prfOutput;
  return { credentialId, prfSalt, prfOutput };
}

export async function assertPasskey(
  allowed: PasskeyRef[],
): Promise<{ credentialId: string; prfOutput: Uint8Array<ArrayBuffer> }> {
  if (allowed.length === 0) throw new Error("No passkeys enrolled");
  const evalByCredential: Record<string, PrfValues> = {};
  for (const p of allowed) evalByCredential[p.credentialId] = { first: p.prfSalt };

  const credential = await call(() =>
    navigator.credentials.get({
      publicKey: {
        rpId: rpId(),
        challenge: randomBytes(32),
        allowCredentials: allowed.map((p) => ({ type: "public-key", id: fromBase64Url(p.credentialId) })),
        userVerification: "required",
        extensions: { prf: { evalByCredential } } as AuthenticationExtensionsClientInputs,
      },
    }),
  );
  const prf = (credential.getClientExtensionResults() as { prf?: PrfOutputs }).prf;
  if (!prf?.results) throw new PasskeyUnsupportedError();
  return { credentialId: toBase64Url(new Uint8Array(credential.rawId)), prfOutput: new Uint8Array(prf.results.first) };
}

async function call(run: () => Promise<Credential | null>): Promise<PublicKeyCredential> {
  try {
    const credential = await run();
    if (!credential) throw new Error("No passkey returned");
    return credential as PublicKeyCredential;
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      throw new Error("Passkey prompt was cancelled or timed out");
    }
    throw err;
  }
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
