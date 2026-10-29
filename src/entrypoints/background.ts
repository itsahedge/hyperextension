import { AUTO_LOCK_ALARM, AUTO_LOCK_CHECK_MINUTES, checkAutoLock, onScreenLocked } from "@/lib/autolock";
import { vpnItem } from "@/lib/storage";
import { routedHosts, VPN_HOST, type VpnMessage, type VpnReply } from "@/lib/vpn";
import { VpnController } from "@/lib/vpnController";

// The popup only runs while open, so locking on a timer or on screen lock
// needs this worker. Chrome wakes it for alarms and idle-state events.
// It also owns the VPN helper's native port, which must outlive the popup.
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

  const vpn = new VpnController({
    connect: () => browser.runtime.connectNative(VPN_HOST),
    lastError: () => browser.runtime.lastError?.message,
    setPac: async (data) => {
      await browser.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data, mandatory: true } }, scope: "regular" });
      const { levelOfControl } = await browser.proxy.settings.get({});
      if (levelOfControl !== "controlled_by_this_extension") {
        throw new Error("Another extension controls Chrome's proxy settings, so the VPN cannot route traffic");
      }
    },
    clearProxy: () => browser.proxy.settings.clear({ scope: "regular" }),
    load: () => vpnItem.getValue(),
    save: (settings) => vpnItem.setValue(settings),
    hosts: routedHosts(browser.runtime.getManifest().host_permissions ?? []),
  });
  void vpn.init().catch((err) => console.error("VPN init failed", err));

  browser.proxy.onProxyError.addListener((details) => console.warn("proxy error", details.error, details.details));

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id || !message || typeof message !== "object" || !("vpn" in message)) return;
    const m = message as VpnMessage;
    const work =
      m.vpn === "state" ? vpn.state() : m.vpn === "servers" ? vpn.servers() : m.vpn === "up" ? vpn.up(m.conf, m.location) : vpn.down();
    void (work as Promise<unknown>).then(
      (value) => sendResponse({ ok: true, value } satisfies VpnReply<unknown>),
      (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies VpnReply<unknown>),
    );
    return true;
  });
});
