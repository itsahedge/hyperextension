import { useState } from "react";
import { useExchange, useOpenOrders } from "@/hooks/queries";
import { fmtPrice, fmtSize, fmtTime } from "@/lib/format";
import type { Market } from "@/lib/markets";
import { cancelTargets, filterByCoin, type OpenOrder } from "@/lib/orderList";
import { cancelOrders, describeCancels, type CancelSummary } from "@/lib/placement";
import { Badge, Button, Card, ConfirmDialog, Empty, Loading, Notice, errorMessage } from "./ui";

// Open orders, optionally limited to one market, with per-order cancel and a
// cancel-all for whatever is listed.
export function OpenOrdersList({ byCoin, coin }: { byCoin: Map<string, Market>; coin: string | null }) {
  const orders = useOpenOrders();
  const [confirmAll, setConfirmAll] = useState(false);
  const cancel = useExchange((client, targets: { a: number; o: number }[]) => cancelOrders(client, targets));
  const rows = filterByCoin(orders.data ?? [], coin);
  const marketName = coin === null ? null : (byCoin.get(coin)?.name ?? coin);
  const pendingOids = cancel.isPending ? new Set(cancel.variables.map((t) => t.o)) : new Set<number>();

  return (
    <Card
      title={`Open orders${marketName ? ` · ${marketName}` : ""} (${rows.length})`}
      action={
        rows.length > 0 && (
          <Button size="sm" variant="ghost" busy={cancel.isPending && cancel.variables.length > 1} onClick={() => (rows.length > 1 ? setConfirmAll(true) : cancel.mutate(cancelTargets(rows, byCoin)))}>
            {marketName ? `Cancel all ${marketName}` : "Cancel all"}
          </Button>
        )
      }
    >
      {orders.isPending ? (
        <Loading />
      ) : orders.isError ? (
        <Notice tone="error">{errorMessage(orders.error)}</Notice>
      ) : rows.length === 0 ? (
        <Empty>No open orders{marketName ? ` for ${marketName}` : ""}</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((o) => (
            <OrderRow
              key={o.oid}
              order={o}
              market={byCoin.get(o.coin)}
              showMarket={coin === null}
              pending={pendingOids.has(o.oid)}
              onCancel={(m) => cancel.mutate([{ a: m.assetId, o: o.oid }])}
            />
          ))}
        </ul>
      )}
      <CancelResult error={cancel.error} summary={cancel.data} />
      <ConfirmDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title={marketName ? `Cancel all ${marketName} orders` : "Cancel all open orders"}
        confirmLabel={`Cancel ${rows.length} orders`}
        variant="danger"
        onConfirm={() => cancel.mutateAsync(cancelTargets(rows, byCoin))}
      >
        Cancels {rows.length} open orders{marketName ? ` on ${marketName}` : " across all markets"}, including TP/SL and stop orders, in one request. Active TWAPs are not affected.
      </ConfirmDialog>
    </Card>
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
