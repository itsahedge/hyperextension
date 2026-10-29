import { useState } from "react";
import { Badge, Button, cx } from "@/components/ui";
import { useSession, useUnlocked } from "@/hooks/session";
import { shortAddress } from "@/lib/format";
import { lock } from "@/lib/session";
import { Activity } from "@/screens/Activity";
import { Portfolio } from "@/screens/Portfolio";
import { Settings } from "@/screens/Settings";
import { Setup } from "@/screens/Setup";
import { Trade } from "@/screens/Trade";
import { Unlock } from "@/screens/Unlock";
import { Wallet } from "@/screens/Wallet";

const TABS = [
  { id: "portfolio", label: "Portfolio", Screen: Portfolio },
  { id: "trade", label: "Trade", Screen: Trade },
  { id: "wallet", label: "Wallet", Screen: Wallet },
  { id: "activity", label: "Activity", Screen: Activity },
  { id: "settings", label: "Settings", Screen: Settings },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App() {
  const session = useSession();
  if (session.status === "empty") return <Setup />;
  if (session.status === "locked") return <Unlock />;
  return <Shell />;
}

function Shell() {
  const { config } = useUnlocked();
  const [tab, setTab] = useState<TabId>("portfolio");
  const { Screen } = TABS.find((t) => t.id === tab)!;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="font-mono text-xs" title={config.address}>
          {shortAddress(config.address)}
        </span>
        <Badge tone={config.mode === "agent" ? "accent" : "neutral"}>{config.mode === "agent" ? "API wallet" : "Master"}</Badge>
        {config.network === "testnet" && <Badge tone="warn">Testnet</Badge>}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void lock()}>
          Lock
        </Button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        <Screen />
      </main>

      <nav aria-label="Sections" className="grid shrink-0 grid-cols-5 border-t border-line">
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
