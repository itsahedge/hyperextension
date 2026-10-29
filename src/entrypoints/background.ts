import { AUTO_LOCK_ALARM, AUTO_LOCK_CHECK_MINUTES, checkAutoLock, onScreenLocked } from "@/lib/autolock";

// The popup only runs while open, so locking on a timer or on screen lock
// needs this worker. Chrome wakes it for alarms and idle-state events.
export default defineBackground(() => {
  // create() with an existing name resets its schedule, so only create once.
  void browser.alarms.get(AUTO_LOCK_ALARM).then((existing) => {
    if (!existing) void browser.alarms.create(AUTO_LOCK_ALARM, { periodInMinutes: AUTO_LOCK_CHECK_MINUTES });
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTO_LOCK_ALARM) void checkAutoLock();
  });

  browser.idle.onStateChanged.addListener((state) => {
    if (state === "locked") void onScreenLocked();
  });
});
