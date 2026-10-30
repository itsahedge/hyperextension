import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { Badge, Button, Loading, Spinner, cx } from "@/components/ui";
import { useActivityTracker } from "@/hooks/activity";
import { useSession, useUnlocked } from "@/hooks/session";
import { useRefetchWhenVpnConnects, useVpnState, useVpnSwitch } from "@/hooks/vpn";
import { lock } from "@/lib/session";
import { Portfolio } from "@/screens/Portfolio";
import { Setup } from "@/screens/Setup";
import { Unlock } from "@/screens/Unlock";

// Portfolio (the first screen) ships in the main chunk; the others load on
// first visit, so opening the popup parses less.
const Trade = lazy(() => import("@/screens/Trade").then((m) => ({ default: m.Trade })));
const Orders = lazy(() => import("@/screens/Orders").then((m) => ({ default: m.Orders })));
const Wallet = lazy(() => import("@/screens/Wallet").then((m) => ({ default: m.Wallet })));
const Activity = lazy(() => import("@/screens/Activity").then((m) => ({ default: m.Activity })));
const Settings = lazy(() => import("@/screens/Settings").then((m) => ({ default: m.Settings })));

const TABS = [
  { id: "portfolio", label: "Portfolio", Screen: Portfolio },
  { id: "trade", label: "Trade", Screen: Trade },
  { id: "orders", label: "Orders", Screen: Orders },
  { id: "wallet", label: "Wallet", Screen: Wallet },
  { id: "activity", label: "Activity", Screen: Activity },
  { id: "settings", label: "Settings", Screen: Settings },
] as const;

type TabId = (typeof TABS)[number]["id"];

// Data also polls on its own (account every 5s, markets every 10s, history
// every 30s); this forces the current screen's queries to refetch now.
// Opens the app in the browser's side panel for this window (full window
// height; the popup is capped at 600px). sidePanel.open must run inside the
// click's user gesture, so the window ID is looked up beforehand.
function SidePanelButton() {
  const [windowId, setWindowId] = useState<number | null>(null);
  useEffect(() => {
    void browser.windows.getCurrent().then((w) => setWindowId(w.id ?? null));
  }, []);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-7 px-0"
      aria-label="Open in side panel"
      title="Open in side panel"
      disabled={windowId === null}
      onClick={() => {
        if (windowId === null) return;
        void browser.sidePanel.open({ windowId }).then(() => window.close());
      }}
    >
      <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" className="size-3.5">
        <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
        <path d="M10 2.5v11" />
      </svg>
    </Button>
  );
}

function RefreshButton() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.refetchQueries({ type: "active" });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="ml-auto w-7 px-0"
      aria-label="Refresh"
      title="Refresh"
      disabled={refreshing}
      onClick={() => void refresh()}
    >
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cx("size-3.5", refreshing && "animate-spin")}
      >
        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
        <path d="M13.5 2.5v3h-3" />
      </svg>
    </Button>
  );
}

export function App() {
  const session = useSession();
  if (session.status === "empty") return <Setup />;
  if (session.status === "locked") return <Unlock />;
  return <Shell />;
}

function Shell() {
  const { config } = useUnlocked();
  useActivityTracker();
  const [tab, setTab] = useState<TabId>("portfolio");
  const { Screen } = TABS.find((t) => t.id === tab)!;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <Badge tone={config.mode === "agent" ? "accent" : "neutral"} title={config.address}>
          {config.mode === "agent" ? "API wallet" : "Master"}
        </Badge>
        {config.network === "testnet" && <Badge tone="warn">Testnet</Badge>}
        <VpnBadge />
        <RefreshButton />
        {document.documentElement.dataset.surface === "popup" && <SidePanelButton />}
        <Button variant="ghost" size="sm" onClick={() => void lock()}>
          Lock
        </Button>
      </header>

      <VpnBanner />
      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        <Suspense fallback={<Loading />}>
          <Screen />
        </Suspense>
      </main>

      <nav aria-label="Sections" className="grid shrink-0 grid-cols-6 border-t border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
            className={cx(
              "h-11 text-xs font-medium transition-colors duration-150",
              tab === t.id ? "text-accent" : "text-muted hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function VpnBadge() {
  const vpn = useVpnState();
  if (!vpn.data?.enabled) return null;
  if (!vpn.data.connected) return <Badge tone="down">VPN down</Badge>;
  // The IVPN server picked in Settings, as IVPN names it. Only for the .conf's
  // own server, fall back to ipinfo's geolocation of the exit IP, which can
  // differ (Holon, Tel Aviv vs Petah_Tiqva) and uses underscores.
  const { exit, location } = vpn.data;
  const where = location
    ? `${location.city}, ${location.countryCode}`
    : exit
      ? [exit.city?.replaceAll("_", " "), exit.country].filter(Boolean).join(", ")
      : "";
  const label = where ? `VPN · ${where}` : "VPN";
  // Shrinks with an ellipsis when the header is crowded (e.g. testnet); full text on hover.
  return (
    <Badge tone="up" className="min-w-0 truncate" title={`${label}${exit ? ` (${exit.ip})` : ""}`}>
      {label}
    </Badge>
  );
}

// Shown while the VPN should be on but is not: routed requests are blocked
// (kill switch), so screens would otherwise show bare fetch errors.
function VpnBanner() {
  const { secrets } = useUnlocked();
  const vpn = useVpnState();
  const toggle = useVpnSwitch();
  useRefetchWhenVpnConnects(vpn.data?.connected);
  const s = vpn.data;
  if (!s?.enabled || s.connected) return null;
  if (s.connecting || toggle.isPending) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2 text-xs text-muted">
        <Spinner /> Connecting VPN… Hyperliquid requests wait until it is up.
      </div>
    );
  }
  const conf = secrets.vpnConf;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-down/10 px-3 py-2 text-xs">
      <span className="min-w-0 flex-1 text-down">
        VPN is down, so Hyperliquid, Arbitrum, Circle and Unit requests are blocked.
        {s.error && <span className="block text-[11px] text-muted">{s.error}</span>}
      </span>
      {conf && (
        <Button size="sm" onClick={() => toggle.mutate({ on: true, conf, location: s.location })}>
          Reconnect
        </Button>
      )}
    </div>
  );
}
