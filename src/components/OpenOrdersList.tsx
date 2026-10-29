import { useState } from "react";
import { useExchange, useOpenOrders } from "@/hooks/queries";
import { fmtPrice, fmtSize, fmtTime } from "@/lib/format";
import type { Market } from "@/lib/markets";
import {
  cancelTargets,
  filterByCoin,
  filterOrders,
  groupByCoin,
  scopeLabel,
  type KindFilter,
  type OpenOrder,
  type SideFilter,
} from "@/lib/orderList";
import { cancelOrders, describeCancels, type CancelSummary } from "@/lib/placement";
import { Badge, Button, Card, ConfirmDialog, Empty, Loading, Notice, Segmented, errorMessage } from "./ui";

interface Scope {
  rows: OpenOrder[];
  label: string;
}

// Open orders for one market (coin set) or all markets, narrowed by side and
// kind. Every bulk cancel acts on exactly the rows on screen for its scope,
// and its label says which.
export function OpenOrdersList({ byCoin, coin }: { byCoin: Map<string, Market>; coin: string | null }) {
  const orders = useOpenOrders();
  const [side, setSide] = useState<SideFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [confirming, setConfirming] = useState<Scope | null>(null);
  const cancel = useExchange((client, targets: { a: number; o: number }[]) => cancelOrders(client, targets));

  const name = (c: string) => byCoin.get(c)?.name ?? c;
  const marketName = coin === null ? null : name(coin);
  const inMarket = filterByCoin(orders.data ?? [], coin);
  const rows = filterOrders(inMarket, { coin: null, side, kind });
  const groups = coin === null ? groupByCoin(rows) : [];
  const pendingOids = cancel.isPending ? new Set(cancel.variables.map((t) => t.o)) : new Set<number>();

  // Counts reflect the other filter, so each number is what you would get.
  const count = (f: { side?: SideFilter; kind?: KindFilter }) =>
    filterOrders(inMarket, { coin: null, side: f.side ?? side, kind: f.kind ?? kind }).length;

  const scope = (scopeRows: OpenOrder[], scopeMarket: string | null): Scope => ({
    rows: scopeRows,
    label: scopeLabel(scopeRows.length, { side, kind }, scopeMarket),
  });
  const request = (sc: Scope) => {
    if (sc.rows.length === 1) cancel.mutate(cancelTargets(sc.rows, byCoin));
    else setConfirming(sc);
  };
  const filtered = side !== "all" || kind !== "all";

  return (
    <Card title={`Open orders${marketName ? ` · ${marketName}` : ""} (${filtered ? `${rows.length} of ${inMarket.length}` : rows.length})`}>
      {orders.isPending ? (
        <Loading />
      ) : orders.isError ? (
        <Notice tone="error">{errorMessage(orders.error)}</Notice>
      ) : inMarket.length === 0 ? (
        <Empty>No open orders{marketName ? ` for ${marketName}` : ""}</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          <Segmented
            label="Side filter"
            value={side}
            onChange={setSide}
            options={[
              { value: "all", label: `All ${count({ side: "all" })}` },
              { value: "buy", label: `Buy ${count({ side: "buy" })}` },
              { value: "sell", label: `Sell ${count({ side: "sell" })}` },
            ]}
          />
          <Segmented
            label="Kind filter"
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: `All ${count({ kind: "all" })}` },
              { value: "limit", label: `Limit ${count({ kind: "limit" })}` },
              { value: "trigger", label: `Triggers ${count({ kind: "trigger" })}` },
            ]}
          />
          {rows.length > 0 && (
            <Button variant="danger" busy={cancel.isPending && cancel.variables.length > 1} onClick={() => request(scope(rows, marketName))}>
              {scope(rows, marketName).label}
            </Button>
          )}
          {rows.length === 0 ? (
            <div className="flex flex-col items-center">
              <Empty>No orders match these filters</Empty>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSide("all");
                  setKind("all");
                }}
              >
                Clear filters
              </Button>
            </div>
          ) : groups.length > 1 ? (
            groups.map((g) => (
              <section key={g.coin} className="rounded-md border border-line">
                <header className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
                  <span className="text-xs font-semibold">
                    {name(g.coin)} <span className="font-normal text-muted">· {g.rows.length}</span>
                  </span>
                  {/* Single-order groups use the row's own Cancel. */}
                  {g.rows.length > 1 && (
                    <Button size="sm" variant="ghost" onClick={() => request(scope(g.rows, name(g.coin)))}>
                      Cancel {g.rows.length}
                    </Button>
                  )}
                </header>
                <OrderRows grouped rows={g.rows} byCoin={byCoin} showMarket={false} pendingOids={pendingOids} onCancel={(t) => cancel.mutate([t])} />
              </section>
            ))
          ) : (
            <OrderRows rows={rows} byCoin={byCoin} showMarket={coin === null} pendingOids={pendingOids} onCancel={(t) => cancel.mutate([t])} />
          )}
        </div>
      )}
      <CancelResult error={cancel.error} summary={cancel.data} />
      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={confirming?.label ?? ""}
        confirmLabel={`Cancel ${confirming?.rows.length ?? 0} orders`}
        dismissLabel="Keep orders"
        variant="danger"
        onConfirm={() => cancel.mutateAsync(cancelTargets(confirming!.rows, byCoin))}
      >
        {confirming && <ScopeBreakdown rows={confirming.rows} name={name} />}
      </ConfirmDialog>
    </Card>
  );
}

function ScopeBreakdown({ rows, name }: { rows: OpenOrder[]; name: (coin: string) => string }) {
  const buys = rows.filter((o) => o.side === "B").length;
  const triggers = rows.filter((o) => o.isTrigger).length;
  const markets = groupByCoin(rows);
  return (
    <>
      <p>
        {buys} buy and {rows.length - buys} sell; {rows.length - triggers} limit and {triggers} trigger (stops, TP/SL).
      </p>
      <p className="mt-1">
        Markets: {markets.map((m) => `${name(m.coin)} (${m.rows.length})`).join(", ")}.
      </p>
      <p className="mt-1">Sent as one request. Orders outside this selection and active TWAPs are not touched.</p>
    </>
  );
}

function OrderRows({
  grouped = false,
  rows,
  byCoin,
  showMarket,
  pendingOids,
  onCancel,
}: {
  grouped?: boolean;
  rows: OpenOrder[];
  byCoin: Map<string, Market>;
  showMarket: boolean;
  pendingOids: Set<number>;
  onCancel: (target: { a: number; o: number }) => void;
}) {
  return (
    <ul className={grouped ? "flex flex-col divide-y divide-line px-2.5 py-1" : "flex flex-col divide-y divide-line"}>
      {rows.map((o) => (
        <OrderRow
          key={o.oid}
          order={o}
          market={byCoin.get(o.coin)}
          showMarket={showMarket}
          pending={pendingOids.has(o.oid)}
          onCancel={(m) => onCancel({ a: m.assetId, o: o.oid })}
        />
      ))}
    </ul>
  );
}

function OrderRow({
  order: o,
  market,
  showMarket,
  pending,
  onCancel,
}: {
  order: OpenOrder;
  market: Market | undefined;
  showMarket: boolean;
  pending: boolean;
  onCancel: (m: Market) => void;
}) {
  const isBuy = o.side === "B";
  // Position TP/SL report size 0: they close whatever the position is.
  const size = Number(o.sz) === 0 && o.isPositionTpsl ? "Position" : fmtSize(o.sz);
  const filled = Number(o.origSz) - Number(o.sz);
  return (
    <li className="flex items-center gap-2 py-2 text-xs first:pt-0 last:pb-0">
      <Badge tone={isBuy ? "up" : "down"}>{isBuy ? "Buy" : "Sell"}</Badge>
      <div className="flex min-w-0 flex-col">
        <span className="font-medium">
          {showMarket && `${market?.name ?? o.coin} `}
          <span className={showMarket ? "text-muted" : ""}>{o.orderType}</span>
          {/* Position TP/SL are always reduce-only; say it once. */}
          {o.isPositionTpsl ? <span className="text-muted"> · position TP/SL</span> : o.reduceOnly && <span className="text-muted"> · reduce</span>}
        </span>
        <span className="text-muted tabular-nums">
          {size} @ {o.isTrigger ? `trigger ${fmtPrice(o.triggerPx)}` : fmtPrice(o.limitPx)}
          {filled > 0 && ` · ${fmtSize(filled)} filled`}
        </span>
        <span className="text-faint">{fmtTime(o.timestamp)}</span>
      </div>
      <Button size="sm" variant="ghost" className="ml-auto" disabled={!market || pending} busy={pending} onClick={() => market && onCancel(market)}>
        Cancel
      </Button>
    </li>
  );
}

function CancelResult({ error, summary }: { error: Error | null; summary: CancelSummary | undefined }) {
  if (error) {
    return (
      <div className="mt-2">
        <Notice tone="error">{errorMessage(error)}</Notice>
      </div>
    );
  }
  if (!summary || summary.total <= 1 && summary.errors.length === 0) return null;
  return (
    <div className="mt-2">
      <Notice tone={summary.errors.length ? "warn" : "success"}>{describeCancels(summary)}</Notice>
    </div>
  );
}
