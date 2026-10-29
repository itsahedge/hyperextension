import { useEffect } from "react";
import { checkAutoLock, recordActivity } from "@/lib/autolock";

const THROTTLE_MS = 10_000;

// Mount only while unlocked. Opening the popup first enforces an expired
// timeout (the background alarm can run late), then input keeps it alive.
export function useActivityTracker() {
  useEffect(() => {
    let last = 0;
    let disposed = false;
    const touch = () => {
      const now = Date.now();
      if (now - last < THROTTLE_MS) return;
      last = now;
      void recordActivity(now);
    };
    void checkAutoLock().then((locked) => {
      if (!locked && !disposed) touch();
    });
    const events = ["pointerdown", "keydown", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    return () => {
      disposed = true;
      events.forEach((e) => window.removeEventListener(e, touch));
    };
  }, []);
}
