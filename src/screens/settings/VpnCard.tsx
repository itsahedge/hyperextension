import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { useState } from "react";
import { AuthorizeDialog } from "@/components/AuthorizeDialog";
import { Button, Card, Notice, Spinner, errorMessage } from "@/components/ui";
import { useUnlocked } from "@/hooks/session";
import { useVpnServers, useVpnState, useVpnSwitch } from "@/hooks/vpn";
import { fmtTime } from "@/lib/format";
import { updateVault } from "@/lib/session";
import { locationLabel, serverName, summarizeConf, type VpnExit, type VpnLocation } from "@/lib/vpn";

const where = (e: VpnExit) => [e.city, e.country].filter(Boolean).join(", ");
const sameLocation = (a?: VpnLocation, b?: VpnLocation) => a?.publicKey === b?.publicKey && a?.host === b?.host;

export function VpnCard() {
  const { secrets } = useUnlocked();
  const conf = secrets.vpnConf;
  return (
    <Card title="VPN (WireGuard)">
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-faint">
          Sends Hyperliquid, Arbitrum, Circle and Unit requests through your WireGuard VPN (such as IVPN). Normal tabs
          visiting those sites use it too. If the VPN drops, those requests are blocked, not sent directly. Needs the
          VPN helper: run <code className="text-muted">pnpm vpn:install</code> once.
        </p>
        {conf ? <VpnControls conf={conf} /> : <ConfEditor />}
      </div>
    </Card>
  );
}

function ConfEditor({ onDone }: { onDone?: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const start = () => {
    try {
      summarizeConf(text);
      setError(null);
      setSaving(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">WireGuard config (.conf)</span>
        <textarea
          rows={7}
          spellCheck={false}
          autoComplete="off"
          placeholder={"[Interface]\nPrivateKey = …\nAddress = …\nDNS = …\n\n[Peer]\nPublicKey = …\nEndpoint = …\nAllowedIPs = 0.0.0.0/0"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="rounded-md border border-line bg-surface p-2 font-mono text-[11px] outline-none placeholder:text-faint focus:border-accent"
        />
        {error && (
          <span role="alert" className="text-xs text-down">
            {error}
          </span>
        )}
      </label>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={!text.trim()} onClick={start}>
          Save config
        </Button>
        {onDone && (
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
      <AuthorizeDialog
        open={saving}
        onClose={() => setSaving(false)}
        title="Save VPN config"
        description="The config holds your WireGuard private key. It is sealed in the vault with your other keys."
        confirmLabel="Save"
        onAuthorized={(auth) =>
          updateVault(auth, (s, c) => ({ secrets: { ...s, vpnConf: text.trim() }, config: c })).then(() => {
            setText("");
            onDone?.();
          })
        }
      />
    </div>
  );
}

function VpnControls({ conf }: { conf: string }) {
  const state = useVpnState();
  const servers = useVpnServers(true);
  const toggle = useVpnSwitch();
  const [picked, setPicked] = useState<VpnLocation | null | undefined>(undefined);
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);

  let summary: { address: string; endpoint: string } | null = null;
  try {
    summary = summarizeConf(conf);
  } catch {
    summary = null;
  }
  if (replacing) return <ConfEditor onDone={() => setReplacing(false)} />;

  const s = state.data;
  // undefined: nothing picked yet, follow the saved choice; null: the .conf's own server.
  const location = picked === undefined ? s?.location : (picked ?? undefined);
  const switching = s?.connected && !sameLocation(location, s.location);
  // Also busy while a connect started elsewhere (unlock reconnect, the banner) runs.
  const busy = toggle.isPending || Boolean(s?.connecting);
  const label = (l?: VpnLocation) => (l ? `${locationLabel(l)} · ${serverName(l)}` : `Server in config (${summary?.endpoint ?? "?"})`);

  return (
    <>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">Config</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{summary ? `${summary.address} · ${summary.endpoint}` : "unreadable"}</span>
        <Button size="sm" variant="ghost" onClick={() => setReplacing(true)}>
          Replace
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRemoving(true)} disabled={s?.enabled}>
          Remove
        </Button>
      </div>

      <Listbox value={location ?? null} onChange={(l: VpnLocation | null) => setPicked(l)} by={(a, b) => sameLocation(a ?? undefined, b ?? undefined)}>
        <div className="relative">
          <ListboxButton
            aria-label="VPN server"
            className="flex h-9 w-full items-center justify-between rounded-md border border-line bg-surface px-2.5 text-xs data-open:border-accent"
          >
            <span className="truncate">{label(location)}</span>
            <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </ListboxButton>
          <ListboxOptions className="absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-md border border-line bg-raised p-1 shadow-lg focus:outline-none">
            <ListboxOption value={null} className="cursor-pointer rounded px-2 py-1.5 text-xs data-focus:bg-line data-selected:text-accent">
              {label(undefined)}
            </ListboxOption>
            {servers.data?.map((l) => (
              <ListboxOption
                key={l.hostname}
                value={l}
                className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-xs data-focus:bg-line data-selected:text-accent"
              >
                <span>
                  {locationLabel(l)} <span className="text-muted">{serverName(l)}</span>
                </span>
                <span className="text-muted tabular-nums">{Math.round(l.load)}%</span>
              </ListboxOption>
            ))}
          </ListboxOptions>
        </div>
      </Listbox>
      {servers.isPending && (
        <span className="flex items-center gap-2 text-xs text-muted">
          <Spinner /> Loading IVPN servers…
        </span>
      )}
      {servers.isError && <Notice tone="warn">Could not list servers: {errorMessage(servers.error)}</Notice>}

      {state.isError && <Notice tone="error">{errorMessage(state.error)}</Notice>}
      {busy ? (
        <span className="flex items-center gap-2 text-xs text-muted">
          <Spinner /> {toggle.isPending && toggle.variables?.on === false ? "Turning off…" : "Connecting and checking the exit IP…"}
        </span>
      ) : (
        s && <VpnStatus state={s} />
      )}
      {toggle.isError && <Notice tone="error">{errorMessage(toggle.error)}</Notice>}

      <div className="flex gap-2">
        {(!s?.enabled || !s.connected || switching) && (
          <Button variant="primary" className="flex-1" busy={busy} disabled={busy || !s} onClick={() => toggle.mutate({ on: true, conf, location })}>
            {!s?.enabled ? "Turn on" : switching ? "Switch server" : "Reconnect"}
          </Button>
        )}
        {s?.enabled && (
          <Button className="flex-1" disabled={busy} onClick={() => toggle.mutate({ on: false })}>
            Turn off
          </Button>
        )}
      </div>

      <AuthorizeDialog
        open={removing}
        onClose={() => setRemoving(false)}
        title="Remove VPN config"
        description="The WireGuard config is deleted from the vault."
        confirmLabel="Remove"
        onAuthorized={(auth) => updateVault(auth, (sec, c) => ({ secrets: { ...sec, vpnConf: undefined }, config: c }))}
      />
    </>
  );
}

function VpnStatus({ state }: { state: NonNullable<ReturnType<typeof useVpnState>["data"]> }) {
  if (!state.enabled) return <p className="text-xs text-muted">Off. Requests go directly from your connection.</p>;
  if (state.connected && state.exit) {
    return (
      <Notice tone={state.unhealthy ? "warn" : "success"}>
        Connected. Exit {state.exit.ip}
        {where(state.exit) && ` (${where(state.exit)})`}; your own IP {state.direct?.ip} is not used for these requests.
        {state.lastHandshake ? ` Last handshake ${fmtTime(state.lastHandshake)}.` : ""}
        {state.unhealthy && ` ${state.unhealthy}.`}
      </Notice>
    );
  }
  return (
    <Notice tone="warn">
      VPN is on but not connected, so routed requests are blocked.{state.error ? ` ${state.error}` : ""}
    </Notice>
  );
}
