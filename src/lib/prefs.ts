import { prefsItem, type Prefs } from "./storage";

export const DEFAULT_PREFS: Prefs = { slippage: 0.01, autoLockMinutes: 15, lockOnScreenLock: true };

export async function loadPrefs(): Promise<Prefs> {
  return { ...DEFAULT_PREFS, ...(await prefsItem.getValue()) };
}

export async function updatePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const next = { ...(await loadPrefs()), ...patch };
  await prefsItem.setValue(next);
  return next;
}
