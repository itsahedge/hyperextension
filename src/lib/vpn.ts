// WireGuard VPN for the extension's own API traffic. MV3 extensions cannot
// open UDP sockets, so the tunnel runs in the hx-vpn native messaging host
// (native/), which Chrome starts on connectNative. The host verifies the exit
// IP and serves a loopback CONNECT proxy; chrome.proxy routes only the
// extension's API hosts to it.
//
//   popup ──runtime message──▶ background (VpnController)
//                                 ├─ PAC: routed hosts -> BLOCKED  (before connecting)
//                                 ├─ connectNative(VPN_HOST) ──▶ hx-vpn: WireGuard + verify + proxy
//                                 └─ PAC: routed hosts -> 127.0.0.1:<port>
//   helper exits / browser restarts -> PAC back to BLOCKED until reconnect or VPN off
//
// chrome.proxy is profile-wide, so normal tabs visiting a routed host use the
// tunnel (or are blocked) too.

// Must stay in sync with scripts/install-vpn-host.sh.
export const VPN_HOST = "hyperextension.vpn";

// `.invalid` never resolves (RFC 6761), so a PAC entry pointing here makes
// routed requests fail instead of going direct.
export const BLOCKED_PROXY = "hx-vpn-blocked.invalid:1";

// One IVPN WireGuard server, as listed by the helper.
export interface VpnLocation {
  country: string;
  countryCode: string;
  city: string;
  hostname: string;
  host: string;
  publicKey: string;
  load: number;
}

export interface VpnExit {
  ip: string;
  city?: string;
  region?: string;
  country?: string;
}

export interface VpnSettings {
  enabled: boolean;
  // Unset: the server in the saved .conf.
  location?: VpnLocation;
}

export interface VpnState {
  enabled: boolean;
  connected: boolean;
  location?: VpnLocation;
  endpoint?: string;
  exit?: VpnExit;
  direct?: VpnExit;
  lastHandshake?: number;
  unhealthy?: string;
  error?: string;
}

export type VpnMessage =
  | { vpn: "state" }
  | { vpn: "servers" }
  | { vpn: "up"; conf: string; location?: VpnLocation }
  | { vpn: "down" };

export type VpnReply<T> = { ok: true; value: T } | { ok: false; error: string };

// Hostnames from manifest host_permissions ("https://host/*"): exactly the
// hosts the extension talks to.
export function routedHosts(hostPermissions: readonly string[]): string[] {
  const hosts = new Set<string>();
  for (const pattern of hostPermissions) {
    const host = /^https:\/\/([a-z0-9.-]+)\/\*$/i.exec(pattern)?.[1];
    if (!host) throw new Error(`Unsupported host permission for VPN routing: ${pattern}`);
    hosts.add(host.toLowerCase());
  }
  return [...hosts].sort();
}

// port null: routed hosts are blocked. Everything else is DIRECT.
export function pacScript(hosts: readonly string[], port: number | null): string {
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error(`Invalid proxy port ${port}`);
  const target = port === null ? BLOCKED_PROXY : `127.0.0.1:${port}`;
  const table = JSON.stringify(Object.fromEntries(hosts.map((h) => [h, true])));
  return [
    "function FindProxyForURL(url, host) {",
    `  var routed = ${table};`,
    "  if (Object.prototype.hasOwnProperty.call(routed, host.toLowerCase())) return " + JSON.stringify(`PROXY ${target}`) + ";",
    '  return "DIRECT";',
    "}",
  ].join("\n");
}

export interface ConfSummary {
  address: string;
  endpoint: string;
}

// Light check before sealing a pasted wg-quick .conf; the helper does the
// full validation (DNS, full tunnel, key formats) when connecting.
export function summarizeConf(conf: string): ConfSummary {
  const lines = conf.split(/\r?\n/).map((l) => l.replace(/[#;].*$/, "").trim());
  const value = (key: string) => {
    for (const line of lines) {
      const eq = line.indexOf("=");
      if (eq > 0 && line.slice(0, eq).trim().toLowerCase() === key.toLowerCase()) return line.slice(eq + 1).trim();
    }
    return undefined;
  };
  const peers = lines.filter((l) => l.toLowerCase() === "[peer]").length;
  if (!lines.some((l) => l.toLowerCase() === "[interface]") || !value("PrivateKey")) throw new Error("Not a WireGuard config: no [Interface] PrivateKey");
  if (peers !== 1) throw new Error("The config needs exactly one [Peer]");
  const endpoint = value("Endpoint");
  const address = value("Address");
  if (!endpoint || !address) throw new Error("The config needs an Address and a peer Endpoint");
  return { address, endpoint };
}

export const locationLabel = (l: VpnLocation) => `${l.city}, ${l.countryCode}`;
export const serverName = (l: VpnLocation) => l.hostname.replace(/\.wg\.ivpn\.net$/, "");
