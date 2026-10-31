import { platform } from "@/platform";
import { validateAccount, type AccountConfig } from "./account";
import { assertPasskey, createPasskey } from "./passkey";
import type { Hex } from "viem";
import { configItem, lastActiveItem, unlockedItem, vaultItem, type UnlockedSession } from "./storage";
import {
  addPasskeySlot,
  createPasskeyVault as createPasskeyVaultData,
  createVault as createVaultData,
  migrateV1,
  openSecrets,
  passkeySalt,
  removePasskeySlot,
  sealSecrets,
  unwrapWithPassword,
  unwrapWithPrf,
  type DataKey,
  type Secrets,
  type StoredVault,
  type VaultV2,
} from "./vault";

export type Auth = { kind: "password"; password: string } | { kind: "passkey" };

export interface PasskeyInfo {
  credentialId: string;
  label: string;
  createdAt: number;
}

export type SessionState =
  | { status: "empty" }
  | { status: "locked"; config: AccountConfig; passkeys: PasskeyInfo[]; hasPassword: boolean }
  | {
      status: "unlocked";
      config: AccountConfig;
      secrets: Secrets;
      hasMasterKey: boolean;
      passkeys: PasskeyInfo[];
      hasPassword: boolean;
    };

export async function loadSession(): Promise<SessionState> {
  const [vault, config, unlocked] = await Promise.all([
    vaultItem.getValue(),
    configItem.getValue(),
    unlockedItem.getValue(),
  ]);
  return deriveSession(vault, config, unlocked);
}

// While unlocked, config comes from the unlocked item, never from
// `local:config`: the two are written separately, and only the unlocked item
// is guaranteed to match the secrets beside it.
export function deriveSession(
  vault: StoredVault | null,
  config: AccountConfig | null,
  unlocked: UnlockedSession | null,
): SessionState {
  if (!vault || !config) return { status: "empty" };
  const passkeys =
    vault.version === 2 ? vault.passkeys.map(({ credentialId, label, createdAt }) => ({ credentialId, label, createdAt })) : [];
  // v1 vaults are password-only.
  const hasPassword = vault.version === 1 || vault.password !== null;
  if (!unlocked) return { status: "locked", config, passkeys, hasPassword };
  return {
    status: "unlocked",
    config: unlocked.config,
    secrets: unlocked.secrets,
    hasMasterKey: unlocked.hasMasterKey,
    passkeys,
    hasPassword,
  };
}

// The part of the secrets the unlocked session holds. In API-wallet mode the
// agent key signs trades and every master-key action (withdraw, deposit,
// approving an API wallet) already re-authorizes, so the master key stays
// sealed in the vault and is opened per action by withMasterKey instead of
// sitting decrypted in session storage. In master mode it is the signer.
export function sessionFor(config: AccountConfig, secrets: Secrets): UnlockedSession {
  const { masterKey, ...rest } = secrets;
  return { config, secrets: config.mode === "master" ? secrets : rest, hasMasterKey: Boolean(masterKey) };
}

// Every vault write checks what it may hold on this platform: the web app
// keeps only an API wallet, so a master key never reaches its storage.
function validateVault(config: AccountConfig, secrets: Secrets) {
  if (secrets.masterKey && !platform.storesMasterKey) {
    throw new Error("This app stores only an API wallet. Keep the master key in the extension.");
  }
  validateAccount(config, secrets);
}

export async function createVault(config: AccountConfig, secrets: Secrets, password: string) {
  validateVault(config, secrets);
  await saveNewVault(config, secrets, (await createVaultData(secrets, password)).vault);
}

// The web app's setup: the vault opens only with a passkey. Validates first,
// so a bad account never leaves a passkey behind in the password manager.
export async function createPasskeyVault(config: AccountConfig, secrets: Secrets, label: string) {
  validateVault(config, secrets);
  const passkey = await createPasskey(label);
  await saveNewVault(config, secrets, (await createPasskeyVaultData(secrets, { ...passkey, label })).vault);
}

async function saveNewVault(config: AccountConfig, secrets: Secrets, vault: VaultV2) {
  await vaultItem.setValue(vault);
  await configItem.setValue(config);
  // Activity first: an auto-lock check between the two writes must not see an
  // unlocked session with no recorded activity.
  await lastActiveItem.setValue(Date.now());
  await unlockedItem.setValue(sessionFor(config, secrets));
}

// Recovers the DEK from any enrolled method. A v1 vault is upgraded in place
// on the first password use; passkeys can only exist on v2.
async function authorize(auth: Auth): Promise<{ vault: VaultV2; dek: DataKey }> {
  const stored = await vaultItem.getValue();
  if (!stored) throw new Error("No vault");

  if (stored.version === 1) {
    if (auth.kind !== "password") throw new Error("Unlock with your password first");
    const { vault, dek } = await migrateV1(stored, auth.password);
    await vaultItem.setValue(vault);
    return { vault, dek };
  }

  if (auth.kind === "password") return { vault: stored, dek: await unwrapWithPassword(stored, auth.password) };

  const { credentialId, prfOutput } = await assertPasskey(
    stored.passkeys.map((slot) => ({ credentialId: slot.credentialId, prfSalt: passkeySalt(slot) })),
  );
  const slot = stored.passkeys.find((s) => s.credentialId === credentialId);
  if (!slot) throw new Error("That passkey is not enrolled in this vault");
  return { vault: stored, dek: await unwrapWithPrf(slot, prfOutput) };
}

export async function unlock(auth: Auth) {
  const config = await configItem.getValue();
  if (!config) throw new Error("No account");
  const { vault, dek } = await authorize(auth);
  const secrets = await openSecrets(vault, dek);
  await lastActiveItem.setValue(Date.now());
  await unlockedItem.setValue(sessionFor(config, secrets));
}

// Runs `use` with the master key opened from the vault for this one action.
// Recovering the DEK proves the user holds the password or an enrolled
// passkey right now (guards against someone at an unlocked browser), and the
// key never enters session storage in API-wallet mode.
export async function withMasterKey<T>(auth: Auth, use: (masterKey: Hex) => Promise<T>): Promise<T> {
  const { vault, dek } = await authorize(auth);
  const { masterKey } = await openSecrets(vault, dek);
  if (!masterKey) throw new Error("This needs the master key, which is not stored in this browser");
  return use(masterKey);
}

export async function lock() {
  await unlockedItem.removeValue();
  await lastActiveItem.removeValue();
}

type VaultChange = { secrets: Secrets; config: AccountConfig };

// Changing vault contents always re-authorizes, even when unlocked. `change`
// runs after authorization succeeds and may be async, so an on-chain step
// (e.g. approveAgent) only happens once the user has proven presence, and the
// vault is written only if that step succeeds.
export async function updateVault(
  auth: Auth,
  change: (secrets: Secrets, config: AccountConfig) => VaultChange | Promise<VaultChange>,
) {
  const config = await configItem.getValue();
  if (!config) throw new Error("No account");
  const { vault, dek } = await authorize(auth);
  const next = await change(await openSecrets(vault, dek), config);
  validateVault(next.config, next.secrets);
  await vaultItem.setValue(await sealSecrets(vault, dek, next.secrets));
  await configItem.setValue(next.config);
  await unlockedItem.setValue(sessionFor(next.config, next.secrets));
}

// Switching to master mode puts the master key in the session as the signer,
// so it re-authorizes; switching to the API wallet needs no auth (updateConfig).
export function setSigningMode(auth: Auth, mode: AccountConfig["mode"]) {
  return updateVault(auth, (secrets, config) => ({ secrets, config: { ...config, mode } }));
}

export async function enrollPasskey(auth: Auth, label: string) {
  const { vault, dek } = await authorize(auth);
  const passkey = await createPasskey(label);
  await vaultItem.setValue(await addPasskeySlot(vault, dek, { ...passkey, label }));
}

export async function removePasskey(auth: Auth, credentialId: string) {
  const { vault } = await authorize(auth);
  await vaultItem.setValue(removePasskeySlot(vault, credentialId));
}

export async function updateConfig(patch: Partial<AccountConfig>) {
  const [config, unlocked] = await Promise.all([configItem.getValue(), unlockedItem.getValue()]);
  if (!config) throw new Error("No account");
  const next = { ...config, ...patch };
  if (unlocked) {
    if (next.mode === "master" && !unlocked.secrets.masterKey && unlocked.hasMasterKey) {
      throw new Error("Switching to the master key needs your passkey or password");
    }
    validateAccount(next, unlocked.secrets);
  }
  await configItem.setValue(next);
  if (unlocked) await unlockedItem.setValue(sessionFor(next, unlocked.secrets));
}

export async function wipe() {
  await Promise.all([vaultItem.removeValue(), configItem.removeValue(), unlockedItem.removeValue(), lastActiveItem.removeValue()]);
}
