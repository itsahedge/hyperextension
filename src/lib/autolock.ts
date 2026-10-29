import { loadPrefs } from "./prefs";
import { lock } from "./session";
import { lastActiveItem, unlockedItem } from "./storage";

export const AUTO_LOCK_CHOICES = [5, 15, 30, 60, 0] as const; // minutes; 0 = never
export const AUTO_LOCK_ALARM = "auto-lock";
// Chrome allows alarms down to once per second; 30s keeps locking within half
// a minute of the deadline without waking the worker constantly.
export const AUTO_LOCK_CHECK_MINUTES = 0.5;

// A missing timestamp while unlocked means activity was never recorded (e.g.
// a session from before auto-lock existed); treat it as expired.
export function idleExpired(now: number, lastActive: number | null, minutes: number): boolean {
  if (!(minutes > 0)) return false;
  if (lastActive === null) return true;
  return now - lastActive >= minutes * 60_000;
}

// Locks if unlocked and idle past the configured timeout. Returns whether it locked.
export async function checkAutoLock(now = Date.now()): Promise<boolean> {
  const [unlocked, lastActive, prefs] = await Promise.all([unlockedItem.getValue(), lastActiveItem.getValue(), loadPrefs()]);
  if (!unlocked || !idleExpired(now, lastActive, prefs.autoLockMinutes)) return false;
  await lock();
  return true;
}

export async function onScreenLocked(): Promise<boolean> {
  const [unlocked, prefs] = await Promise.all([unlockedItem.getValue(), loadPrefs()]);
  if (!unlocked || !prefs.lockOnScreenLock) return false;
  await lock();
  return true;
}

export async function recordActivity(now = Date.now()) {
  await lastActiveItem.setValue(now);
}
