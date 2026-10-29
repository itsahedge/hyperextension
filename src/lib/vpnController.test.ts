import { describe, expect, it } from "vitest";
import { BLOCKED_PROXY, type VpnLocation, type VpnSettings } from "./vpn";
import { VpnController, type NativePort } from "./vpnController";

const HOSTS = ["api.hyperliquid.xyz", "api.hyperunit.xyz"];
const CONF = "[Interface]\nPrivateKey = k\n[Peer]\nEndpoint = 1.2.3.4:2049";
const ZURICH: VpnLocation = {
  country: "Switzerland",
  countryCode: "CH",
  city: "Zurich",
  hostname: "ch01.wg.ivpn.net",
  host: "185.212.170.2",
  publicKey: "YNQzD8ZKP0Ev1dz2ri0V9b8bUsXN2C+4TBrqYGJz1Wk=",
  load: 10,
};
const tick = () => new Promise((r) => setTimeout(r, 0));

type HelperResult = Record<string, unknown> | "exit" | "silent";
type Helper = (msg: Record<string, unknown>) => HelperResult | Promise<HelperResult>;

// A fake Chrome: native ports answered by `helper`, PAC scripts recorded.
function harness(helper: Helper, opts: { settings?: VpnSettings; missing?: boolean } = {}) {
  let settings: VpnSettings = opts.settings ?? { enabled: false };
  const pacs: (string | null)[] = [];
  const sent: Record<string, unknown>[] = [];
  let lastError: string | undefined;
  let connects = 0;
  let live: { disconnect: () => void } | null = null;

  const connect = (): NativePort => {
    connects++;
    const onMessage: ((m: unknown) => void)[] = [];
    const onDisconnect: (() => void)[] = [];
    let open = true;
    const close = (err?: string) => {
      if (!open) return;
      open = false;
      lastError = err;
      onDisconnect.forEach((cb) => cb());
      lastError = undefined;
    };
    live = { disconnect: () => close("helper exited") };
    if (opts.missing) queueMicrotask(() => close("Specified native messaging host not found."));
    return {
      postMessage: (m) => {
        const msg = m as Record<string, unknown>;
        sent.push(msg);
        if (opts.missing) return;
        queueMicrotask(async () => {
          const r = await helper(msg);
          if (!open) return;
          if (r === "exit") close();
          else if (r !== "silent") onMessage.forEach((cb) => cb({ id: msg.id, type: msg.type, ...r }));
        });
      },
      disconnect: () => {
        open = false;
      },
      onMessage: { addListener: (cb) => onMessage.push(cb) },
      onDisconnect: { addListener: (cb) => onDisconnect.push(cb) },
    };
  };

  const vpn = new VpnController({
    connect,
    lastError: () => lastError,
    setPac: async (s) => void pacs.push(s),
    clearProxy: async () => void pacs.push(null),
    load: async () => settings,
    save: async (s) => void (settings = s),
    hosts: HOSTS,
  });
  const routedTo = (i = pacs.length - 1) => {
    const pac = pacs[i];
    if (pac === null) return "cleared";
    return /PROXY ([^"]+)"/.exec(pac ?? "")?.[1];
  };
  return { vpn, pacs, sent, routedTo, settings: () => settings, connects: () => connects, crash: () => live?.disconnect() };
}

const upReply = { up: true, port: 51234, endpoint: "185.212.170.2:2049", check: { tunnel: { ip: "185.212.170.9", city: "Zurich", country: "CH" }, direct: { ip: "203.0.113.9" } } };
const healthy: Helper = (m) => (m.type === "up" ? upReply : m.type === "status" ? { up: true, port: 51234, lastHandshake: 1_700_000_000_000 } : {});

describe("VpnController", () => {
  it("blocks before connecting, then routes to the verified tunnel", async () => {
    const h = harness(healthy);
    const state = await h.vpn.up(CONF, ZURICH);
    expect(h.routedTo(0)).toBe(BLOCKED_PROXY);
    expect(h.routedTo()).toBe("127.0.0.1:51234");
    expect(h.sent[0]!).toMatchObject({ type: "up", conf: CONF, hosts: HOSTS, server: { host: ZURICH.host, publicKey: ZURICH.publicKey } });
    expect(state).toMatchObject({ enabled: true, connected: true, location: ZURICH, exit: { ip: "185.212.170.9" }, direct: { ip: "203.0.113.9" }, lastHandshake: 1_700_000_000_000 });
    expect(h.settings()).toEqual({ enabled: true, location: ZURICH });
  });

  it("uses the config's own server when no location is picked", async () => {
    const h = harness(healthy);
    await h.vpn.up(CONF);
    expect(h.sent[0]?.server).toBeUndefined();
  });

  it("stays blocked when the helper refuses", async () => {
    const h = harness((m) => (m.type === "up" ? { error: "the tunnel exits from your own IP 203.0.113.9; it is not a VPN route" } : {}));
    const state = await h.vpn.up(CONF);
    expect(h.routedTo()).toBe(BLOCKED_PROXY);
    expect(state).toMatchObject({ enabled: true, connected: false, error: expect.stringContaining("not a VPN route") });
  });

  it("explains a missing helper and stays blocked", async () => {
    const h = harness(healthy, { missing: true });
    const state = await h.vpn.up(CONF);
    expect(state.connected).toBe(false);
    expect(state.error).toMatch(/pnpm vpn:install/);
    expect(h.routedTo()).toBe(BLOCKED_PROXY);
  });

  it("re-blocks when the helper exits while connected", async () => {
    const h = harness(healthy);
    await h.vpn.up(CONF);
    h.crash();
    await tick();
    expect(h.routedTo()).toBe(BLOCKED_PROXY);
    expect(await h.vpn.state()).toMatchObject({ enabled: true, connected: false, error: expect.stringContaining("helper exited") });
  });

  it("re-blocks when status says the tunnel is gone", async () => {
    let up = true;
    const h = harness((m) => (m.type === "up" ? upReply : m.type === "status" ? { up } : {}));
    await h.vpn.up(CONF);
    up = false;
    expect(await h.vpn.state()).toMatchObject({ connected: false, error: "The VPN tunnel stopped" });
    expect(h.routedTo()).toBe(BLOCKED_PROXY);
  });

  it("turning off stops the helper and clears the proxy", async () => {
    const h = harness(healthy);
    await h.vpn.up(CONF, ZURICH);
    const state = await h.vpn.down();
    expect(h.sent.map((m) => m.type)).toContain("down");
    expect(h.routedTo()).toBe("cleared");
    expect(state).toMatchObject({ enabled: false, connected: false, location: ZURICH });
  });

  it("init blocks only when the VPN is meant to be on", async () => {
    const off = harness(healthy);
    await off.vpn.init();
    expect(off.pacs).toEqual([]);
    const on = harness(healthy, { settings: { enabled: true } });
    await on.vpn.init();
    expect(on.routedTo()).toBe(BLOCKED_PROXY);
    expect(on.connects()).toBe(0);
  });

  it("a server listing finishing mid-connect does not stop the helper", async () => {
    let releaseServers!: () => void;
    let releaseUp!: () => void;
    const serversGate = new Promise<void>((r) => (releaseServers = r));
    const upGate = new Promise<void>((r) => (releaseUp = r));
    const h = harness(async (m) => {
      if (m.type === "servers") {
        await serversGate;
        return { servers: [ZURICH] };
      }
      if (m.type === "up") await upGate;
      return healthy(m);
    });
    const listing = h.vpn.servers();
    const connecting = h.vpn.up(CONF);
    await tick();
    expect(h.sent.map((m) => m.type)).toEqual(["servers", "up"]);
    // The listing finishes while up is still waiting on the helper.
    releaseServers();
    expect(await listing).toEqual([ZURICH]);
    releaseUp();
    const state = await connecting;
    expect(state.error).toBeUndefined();
    expect(state.connected).toBe(true);
    expect(h.connects()).toBe(1);
  });

  it("lists servers without leaving the helper running", async () => {
    const h = harness((m) => (m.type === "servers" ? { servers: [ZURICH] } : {}));
    expect(await h.vpn.servers()).toEqual([ZURICH]);
    await h.vpn.servers();
    expect(h.connects()).toBe(2);
  });
});
