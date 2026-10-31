import { AUTO_LOCK_CHECK_MINUTES, checkAutoLock } from "@/lib/autolock";
import { mountApp } from "@/mountApp";

// No background worker on the web: the page enforces auto-lock while open and
// as soon as the tab is shown again (mobile browsers pause timers in the
// background). Decrypted keys are in page memory, so closing or reloading the
// tab also locks.
const check = () => void checkAutoLock();
setInterval(check, AUTO_LOCK_CHECK_MINUTES * 60_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") check();
});

// Ask the browser not to evict the encrypted vault under storage pressure.
void navigator.storage?.persist?.();

mountApp();
