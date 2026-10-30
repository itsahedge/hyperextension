import { useMemo, useState } from "react";
import { ActiveTwaps } from "@/components/ActiveTwaps";
import { MarketFilter } from "@/components/MarketFilter";
import { OpenOrdersList } from "@/components/OpenOrdersList";
import { Badge, Card, Empty, Loading, Notice, Segmented, errorMessage } from "@/components/ui";
import { useMarketData, useOpenOrders, useOrderHistory } from "@/hooks/queries";
import { useUnlocked } from "@/hooks/session";
import { fmtPrice, fmtSize, fmtTime } from "@/lib/format";
import type { Market } from "@/lib/markets";
import { closedHistory, coinsOf, filterByCoin, statusInfo, type StatusGroup } from "@/lib/orderList";

const HISTORY_LIMIT = 200;

export function Orders() {
  const { config } = useUnlocked();
  const markets = useMarketData(config.network);
  const [view, setView] = useState<"open" | "history">("open");
  const [coin, setCoin] = useState<string | null>(null);

  if (markets.isPending) return <Loading />;
  if (markets.isError) return <Notice tone="error">{errorMessage(markets.error)}</Notice>;
  const byCoin = markets.data.byCoin;

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="Orders view"
        value={view}
        onChange={(v) => {
          setView(v);
          setCoin(null);
        }}
        options={[
          { value: "open", label: "Open" },
          { value: "history", label: "History" },
        ]}
      />
      {view === "open" ? <OpenView byCoin={byCoin} coin={coin} setCoin={setCoin} /> : <HistoryView byCoin={byCoin} coin={coin} setCoin={setCoin} />}
    </div>
  );
}

type ViewProps = { byCoin: Map<string, Market>; coin: string | null; setCoin: (c: string | null) => void };

function countBy(rows: { coin: string }[]) {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.coin, (counts.get(r.coin) ?? 0) + 1);
  return counts;
}

function OpenView({ byCoin, coin, setCoin }: ViewProps) {
  const orders = useOpenOrders();
  const rows = orders.data ?? [];
  const coins = coinsOf(rows);
  // If the filtered market's last order goes away, fall back to all markets.
  const active = coin !== null && coins.includes(coin) ? coin : null;
  return (
    <>
      {coins.length > 0 && <MarketFilter value={active} onChange={setCoin} coins={coins} counts={countBy(rows)} byCoin={byCoin} />}
      <OpenOrdersList byCoin={byCoin} coin={active} />
      <ActiveTwaps byCoin={byCoin} />
    </>
  );
}

const GROUPS: { value: "all" | StatusGroup; label: string }[] = [
  { value: "all", label: "All" },
  { value: "filled", label: "Filled" },
  { value: "canceled", label: "Canceled" },
  { value: "rejected", label: "Rejected" },
];

const TONES: Record<StatusGroup, "up" | "down" | "neutral" | "accent" | "warn"> = {
  open: "accent",
  filled: "up",
  triggered: "accent",
  canceled: "neutral",
  rejected: "down",
};

function HistoryView({ byCoin, coin, setCoin }: ViewProps) {
  const history = useOrderHistory();
  const [group, setGroup] = useState<"all" | StatusGroup>("all");
  const closed = useMemo(() => closedHistory(history.data ?? []), [history.data]);
  const withCoin = useMemo(() => closed.map((h) => ({ ...h, coin: h.order.coin })), [closed]);

  if (history.isPending) return <Loading />;
  if (history.isError) return <Notice tone="error">{errorMessage(history.error)}</Notice>;

  const coins = coinsOf(withCoin);
  const rows = filterByCoin(withCoin, coin).filter((h) => {
    if (group === "all") return true;
    const g = statusInfo(h.status).group;
    // Triggered orders became live orders; group them with filled for filtering.
    return group === "filled" ? g === "filled" || g === "triggered" : g === group;
  });

  return (
    <>
      {coins.length > 0 && <MarketFilter value={coin} onChange={setCoin} coins={coins} counts={countBy(withCoin)} byCoin={byCoin} />}
      <Segmented label="Status" value={group} onChange={setGroup} options={GROUPS} />
      <Card title={`History (${rows.length})`}>
        {rows.length === 0 ? (
          <Empty>No orders</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {rows.slice(0, HISTORY_LIMIT).map(({ order: o, status, statusTimestamp }) => {
              const info = statusInfo(status);
              const isBuy = o.side === "B";
              const filled = Number(o.origSz) - Number(o.sz);
              return (
                <li key={`${o.oid}-${statusTimestamp}`} className="flex items-start gap-2 py-2 text-xs first:pt-0 last:pb-0">
                  <Badge tone={isBuy ? "up" : "down"}>{isBuy ? "Buy" : "Sell"}</Badge>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">
                      {byCoin.get(o.coin)?.label ?? o.coin} <span className="text-muted">{o.orderType}</span>
                      {o.reduceOnly && <span className="text-muted"> · reduce</span>}
                    </span>
                    <span className="text-muted tabular-nums">
                      {fmtSize(o.origSz)} @ {o.isTrigger ? `trigger ${fmtPrice(o.triggerPx)}` : fmtPrice(o.limitPx)}
                      {filled > 0 && info.group !== "filled" && ` · ${fmtSize(filled)} filled`}
                    </span>
                    {info.reason && <span className="text-faint">{info.reason}</span>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <Badge tone={TONES[info.group]}>{info.label}</Badge>
                    <span className="text-faint">{fmtTime(statusTimestamp)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > HISTORY_LIMIT && <p className="mt-2 text-center text-[11px] text-faint">Showing the latest {HISTORY_LIMIT}</p>}
      </Card>
    </>
  );
}
