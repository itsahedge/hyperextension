import { validateAccount, type AccountConfig } from "./account";
import { assertPasskey, createPasskey } from "./passkey";
import { configItem, unlockedItem, vaultItem } from "./storage";
import {
  addPasskeySlot,
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
  | { status: "locked"; config: AccountConfig; passkeys: PasskeyInfo[] }
  | { status: "unlocked"; config: AccountConfig; secrets: Secrets; passkeys: PasskeyInfo[] };

export async function loadSession(): Promise<SessionState> {
  const [vault, config, secrets] = await Promise.all([
    vaultItem.getValue(),
    configItem.getValue(),
    unlockedItem.getValue(),
  ]);
  if (!vault || !config) return { status: "empty" };
  const passkeys =
    vault.version === 2 ? vault.passkeys.map(({ credentialId, label, createdAt }) => ({ credentialId, label, createdAt })) : [];
  if (!secrets) return { status: "locked", config, passkeys };
  return { status: "unlocked", config, secrets, passkeys };
}

export async function createVault(config: AccountConfig, secrets: Secrets, password: string) {
  validateAccount(config, secrets);
  const { vault } = await createVaultData(secrets, password);
  await vaultItem.setValue(vault);
  await configItem.setValue(config);
  await unlockedItem.setValue(secrets);
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
  const { vault, dek } = await authorize(auth);
  await unlockedItem.setValue(await openSecrets(vault, dek));
}

// Step-up check for sensitive actions while already unlocked. Recovering the
// DEK proves the user holds the password or an enrolled passkey right now.
// This guards against someone at an unlocked browser, not against code that
// can already read session storage.
export async function verify(auth: Auth) {
  await authorize(auth);
}

export async function lock() {
  await unlockedItem.removeValue();
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
  validateAccount(next.config, next.secrets);
  await vaultItem.setValue(await sealSecrets(vault, dek, next.secrets));
  await configItem.setValue(next.config);
  await unlockedItem.setValue(next.secrets);
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
  const [config, secrets] = await Promise.all([configItem.getValue(), unlockedItem.getValue()]);
  if (!config) throw new Error("No account");
  const next = { ...config, ...patch };
  if (secrets) validateAccount(next, secrets);
  await configItem.setValue(next);
}

export async function wipe() {
  await Promise.all([vaultItem.removeValue(), configItem.removeValue(), unlockedItem.removeValue()]);
}
