import { validateAccount, type AccountConfig } from "./account";
import { configItem, unlockedItem, vaultItem } from "./storage";
import { decryptSecrets, encryptSecrets, type Secrets } from "./vault";

export type SessionState =
  | { status: "empty" }
  | { status: "locked"; config: AccountConfig }
  | { status: "unlocked"; config: AccountConfig; secrets: Secrets };

export async function loadSession(): Promise<SessionState> {
  const [vault, config, secrets] = await Promise.all([
    vaultItem.getValue(),
    configItem.getValue(),
    unlockedItem.getValue(),
  ]);
  if (!vault || !config) return { status: "empty" };
  if (!secrets) return { status: "locked", config };
  return { status: "unlocked", config, secrets };
}

export async function createVault(config: AccountConfig, secrets: Secrets, password: string) {
  validateAccount(config, secrets);
  const vault = await encryptSecrets(secrets, password);
  await vaultItem.setValue(vault);
  await configItem.setValue(config);
  await unlockedItem.setValue(secrets);
}

export async function unlock(password: string) {
  const vault = await vaultItem.getValue();
  if (!vault) throw new Error("No vault");
  await unlockedItem.setValue(await decryptSecrets(vault, password));
}

// Throws WrongPasswordError; used to gate on-chain actions that precede a vault write.
export async function verifyPassword(password: string) {
  const vault = await vaultItem.getValue();
  if (!vault) throw new Error("No vault");
  await decryptSecrets(vault, password);
}

export async function lock() {
  await unlockedItem.removeValue();
}

// Changing vault contents always re-checks the password, even when unlocked.
export async function updateVault(
  password: string,
  change: (secrets: Secrets, config: AccountConfig) => { secrets: Secrets; config: AccountConfig },
) {
  const [vault, config] = await Promise.all([vaultItem.getValue(), configItem.getValue()]);
  if (!vault || !config) throw new Error("No vault");
  const next = change(await decryptSecrets(vault, password), config);
  validateAccount(next.config, next.secrets);
  await vaultItem.setValue(await encryptSecrets(next.secrets, password));
  await configItem.setValue(next.config);
  await unlockedItem.setValue(next.secrets);
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
