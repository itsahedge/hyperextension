import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { VpnLocation, VpnMessage, VpnReply, VpnState } from "@/lib/vpn";
import { relayVpnRequest, type VpnRequest } from "@/lib/vpnRelay";
import { platform } from "@/platform";

// The extension's switch is its background worker (VpnController, with the
// .conf from the vault); the web app's is the Mac mini (lib/vpnRelay).
async function send<T>(request: VpnRequest): Promise<T> {
  if (platform.vpn === "relay") return relayVpnRequest<T>(request);
  if (request.vpn === "up" && !request.conf) throw new Error("No VPN config in the vault");
  const message = request as VpnMessage;
  let reply: VpnReply<T> | undefined;
  try {
    reply = (await browser.runtime.sendMessage(message)) as VpnReply<T> | undefined;
  } catch (err) {
    // Chrome's text when no listener exists: the worker still runs a build
    // from before the VPN, or failed to start.
    if (/receiving end does not exist/i.test(String(err))) {
      throw new Error("The extension's background worker is not answering. Reload the extension in chrome://extensions.");
    }
    throw err;
  }
  if (!reply) throw new Error("The background worker did not answer");
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

// Polls faster while the VPN should be on but is not up yet (reconnect after
// unlock), so the popup notices the tunnel within seconds.
export function useVpnState() {
  return useQuery({
    queryKey: ["vpn"],
    queryFn: () => send<VpnState>({ vpn: "state" }),
    refetchInterval: (q) => (q.state.data?.enabled && !q.state.data.connected ? 2_000 : 15_000),
  });
}

// Requests made while the tunnel was down failed at the proxy; refetch them
// once it comes up.
export function useRefetchWhenVpnConnects(connected: boolean | undefined) {
  const queryClient = useQueryClient();
  const was = useRef(connected);
  useEffect(() => {
    if (connected && was.current === false) {
      void queryClient.invalidateQueries({ predicate: (q) => !["vpn", "vpnServers"].includes(String(q.queryKey[0])) });
    }
    was.current = connected;
  }, [connected, queryClient]);
}

export function useVpnServers(enabled: boolean) {
  return useQuery({
    queryKey: ["vpnServers"],
    queryFn: () => send<VpnLocation[]>({ vpn: "servers" }),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function useVpnSwitch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (m: { on: true; conf?: string; location?: VpnLocation } | { on: false }) =>
      send<VpnState>(m.on ? { vpn: "up", conf: m.conf, location: m.location } : { vpn: "down" }),
    onSuccess: async (state) => {
      queryClient.setQueryData(["vpn"], state);
      // Everything routed now leaves through a different path; refetch it.
      await queryClient.invalidateQueries({ predicate: (q) => !["vpn", "vpnServers", "markets"].includes(String(q.queryKey[0])) });
    },
  });
}
