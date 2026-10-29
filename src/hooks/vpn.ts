import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { VpnLocation, VpnMessage, VpnReply, VpnState } from "@/lib/vpn";

async function send<T>(message: VpnMessage): Promise<T> {
  const reply = (await browser.runtime.sendMessage(message)) as VpnReply<T> | undefined;
  if (!reply) throw new Error("The background worker did not answer");
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

export function useVpnState() {
  return useQuery({ queryKey: ["vpn"], queryFn: () => send<VpnState>({ vpn: "state" }), refetchInterval: 15_000 });
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
    mutationFn: (m: { on: true; conf: string; location?: VpnLocation } | { on: false }) =>
      send<VpnState>(m.on ? { vpn: "up", conf: m.conf, location: m.location } : { vpn: "down" }),
    onSuccess: async (state) => {
      queryClient.setQueryData(["vpn"], state);
      // Everything routed now leaves through a different path; refetch it.
      await queryClient.invalidateQueries({ predicate: (q) => !["vpn", "vpnServers", "markets"].includes(String(q.queryKey[0])) });
    },
  });
}
