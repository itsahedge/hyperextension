import type { VpnLocation } from "./vpn";

// The web app's VPN switch lives on the Mac mini (native/internal/webhost):
// the WireGuard config is in KeePassXC there, so turning the VPN on sends
// only the server choice, never a config.
export type VpnRequest = { vpn: "state" } | { vpn: "servers" } | { vpn: "up"; conf?: string; location?: VpnLocation } | { vpn: "down" };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function relayVpnRequest<T>(m: VpnRequest, fetchImpl: Fetch = fetch): Promise<T> {
  const json = { "Content-Type": "application/json" };
  const res =
    m.vpn === "state" || m.vpn === "servers"
      ? await fetchImpl(`/api/vpn/${m.vpn}`, { method: "GET" })
      : await fetchImpl(`/api/vpn/${m.vpn}`, {
          method: "POST",
          headers: json,
          body: m.vpn === "up" ? JSON.stringify({ location: m.location }) : "{}",
        });
  if (!res.ok) throw new Error(`Mac mini: ${(await res.text()).trim() || `HTTP ${res.status}`}`);
  return (await res.json()) as T;
}
