import { useState } from "react";
import { Empty, Loading, Notice, Segmented, errorMessage } from "@/components/ui";
import { useBook, useMarketData } from "@/hooks/queries";
import { useUnlocked } from "@/hooks/session";
import { initialPanel, ORDER_TYPES, type PanelState } from "@/lib/entry";
import type { Market, MarketKind } from "@/lib/markets";
import { ActiveTwaps } from "./trade/ActiveTwaps";
import { MarketHeader, MarketPicker } from "./trade/MarketPicker";
import { OpenOrders } from "./trade/OpenOrders";
import { OrderPanel } from "./trade/OrderPanel";

// Prices and sizes are per market; switching markets clears them but keeps
// the order type and its settings.
const PER_MARKET: (keyof PanelState)[] = ["size", "price", "trigger", "stopLimit", "scaleA", "scaleB", "tp", "sl"];

export function Trade() {
  const { config } = useUnlocked();
  const data = useMarketData(config.network);
  const [kind, setKind] = useState<MarketKind>("perp");
  const [coin, setCoin] = useState<Record<MarketKind, string | null>>({ perp: null, spot: null });
  const [panel, setPanel] = useState<PanelState>(initialPanel);

  if (data.isPending) return <Loading />;
  if (data.isError) return <Notice tone="error">{errorMessage(data.error)}</Notice>;

  const list = data.data.markets.filter((m) => m.kind === kind);
  const selected = data.data.byCoin.get(coin[kind] ?? "") ?? list[0];

  const resetForMarket = (m: Market) => {
    setPanel((p) => {
      const next = { ...p };
      for (const k of PER_MARKET) (next as Record<string, unknown>)[k] = initialPanel[k];
      // Perp-only types fall back to a plain limit on spot.
      if (m.kind !== "perp" && ORDER_TYPES.find((t) => t.id === p.type)?.perpOnly) next.type = "limit";
      if (m.kind !== "perp") Object.assign(next, { reduce: false, tpsl: false });
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="Market type"
        value={kind}
        onChange={(k) => {
          setKind(k);
          const next = data.data.byCoin.get(coin[k] ?? "") ?? data.data.markets.find((m) => m.kind === k);
          if (next) resetForMarket(next);
        }}
        options={[
          { value: "perp", label: "Perps" },
          { value: "spot", label: "Spot" },
        ]}
      />
      {selected ? (
        <>
          <MarketPicker
            markets={list}
            value={selected}
            onChange={(m) => {
              setCoin((c) => ({ ...c, [kind]: m.coin }));
              if (m.coin !== selected.coin) resetForMarket(m);
            }}
          />
          <MarketHeader market={selected} />
          <PanelWithBook market={selected} panel={panel} setPanel={setPanel} />
        </>
      ) : (
        <Empty>No markets</Empty>
      )}
      <ActiveTwaps byCoin={data.data.byCoin} />
      <OpenOrders byCoin={data.data.byCoin} />
    </div>
  );
}

function PanelWithBook({ market, panel, setPanel }: { market: Market; panel: PanelState; setPanel: (f: (p: PanelState) => PanelState) => void }) {
  const { config } = useUnlocked();
  const book = useBook(config.network, market.coin);
  return <OrderPanel market={market} book={book.data} s={panel} set={(patch) => setPanel((p) => ({ ...p, ...patch }))} />;
}
