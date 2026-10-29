import { useEffect, useState } from "react";
import { Empty, Loading, Notice, Segmented, errorMessage } from "@/components/ui";
import { useBook, useFavorites, useMarketData } from "@/hooks/queries";
import { useUnlocked } from "@/hooks/session";
import { initialPanel, ORDER_TYPES, type PanelState } from "@/lib/entry";
import type { Market, MarketKind } from "@/lib/markets";
import { ActiveTwaps } from "@/components/ActiveTwaps";
import { OpenOrdersList } from "@/components/OpenOrdersList";
import { withFavoritesFirst } from "@/lib/favorites";
import { FavoriteChips, MarketHeader, MarketPicker } from "./trade/MarketPicker";
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
  const favorites = useFavorites(config.network);

  // Pick the opening market once per type, after favorites load: the first
  // favorite, else the top market. Pinning it means starring something later
  // never switches the market out from under an open order form.
  const markets = data.data?.markets;
  useEffect(() => {
    if (!markets || !favorites.ready || coin[kind] !== null) return;
    const ofKind = markets.filter((m) => m.kind === kind);
    const initial = withFavoritesFirst(ofKind, favorites.list).favorites[0] ?? ofKind[0];
    if (initial) setCoin((c) => ({ ...c, [kind]: initial.coin }));
  }, [markets, favorites.ready, favorites.list, kind, coin]);

  if (data.isPending) return <Loading />;
  if (data.isError) return <Notice tone="error">{errorMessage(data.error)}</Notice>;

  const list = data.data.markets.filter((m) => m.kind === kind);
  const favMarkets = withFavoritesFirst(list, favorites.list).favorites;
  const selected = data.data.byCoin.get(coin[kind] ?? "");
  const pick = (m: Market) => {
    setCoin((c) => ({ ...c, [kind]: m.coin }));
    if (selected && m.coin !== selected.coin) resetForMarket(m);
  };

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
          const ofKind = data.data.markets.filter((m) => m.kind === k);
          const next = data.data.byCoin.get(coin[k] ?? "") ?? withFavoritesFirst(ofKind, favorites.list).favorites[0] ?? ofKind[0];
          if (next) resetForMarket(next);
        }}
        options={[
          { value: "perp", label: "Perps" },
          { value: "spot", label: "Spot" },
        ]}
      />
      {selected ? (
        <>
          <MarketPicker markets={list} value={selected} onChange={pick} favorites={favorites.list} onToggleFavorite={favorites.toggle} />
          <FavoriteChips markets={favMarkets} value={selected} onChange={pick} />
          <MarketHeader market={selected} />
          <PanelWithBook market={selected} panel={panel} setPanel={setPanel} />
        </>
      ) : list.length > 0 ? (
        <Loading />
      ) : (
        <Empty>No markets</Empty>
      )}
      {selected && <OpenOrdersList byCoin={data.data.byCoin} coin={selected.coin} />}
      <ActiveTwaps byCoin={data.data.byCoin} />
    </div>
  );
}

function PanelWithBook({ market, panel, setPanel }: { market: Market; panel: PanelState; setPanel: (f: (p: PanelState) => PanelState) => void }) {
  const { config } = useUnlocked();
  const book = useBook(config.network, market.coin);
  return <OrderPanel market={market} book={book.data} s={panel} set={(patch) => setPanel((p) => ({ ...p, ...patch }))} />;
}
