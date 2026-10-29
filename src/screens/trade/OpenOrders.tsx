import { Badge, Button, Card, Empty, Loading, Notice, errorMessage } from "@/components/ui";
import { useExchange, useOpenOrders } from "@/hooks/queries";
import { fmtPrice, fmtSize } from "@/lib/format";
import type { Market } from "@/lib/markets";

export function OpenOrders({ byCoin }: { byCoin: Map<string, Market> }) {
  const orders = useOpenOrders();
  const cancel = useExchange((client, o: { a: number; o: number }) => client.cancel({ cancels: [o] }));
  const cancelAll = useExchange((client, list: { a: number; o: number }[]) => client.cancel({ cancels: list }));

  const rows = orders.data ?? [];
  const cancellable = rows.flatMap((o) => {
    const m = byCoin.get(o.coin);
    return m ? [{ a: m.assetId, o: o.oid }] : [];
  });

  return (
    <Card
      title={`Open orders (${rows.length})`}
      action={
        rows.length > 1 && (
          <Button size="sm" variant="ghost" busy={cancelAll.isPending} onClick={() => cancelAll.mutate(cancellable)}>
            Cancel all
          </Button>
        )
      }
    >
      {orders.isPending ? (
        <Loading />
      ) : orders.isError ? (
        <Notice tone="error">{errorMessage(orders.error)}</Notice>
      ) : rows.length === 0 ? (
        <Empty>No open orders</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((o) => {
            const m = byCoin.get(o.coin);
            const isBuy = o.side === "B";
            return (
              <li key={o.oid} className="flex items-center gap-2 py-2 text-xs first:pt-0 last:pb-0">
                <Badge tone={isBuy ? "up" : "down"}>{isBuy ? "Buy" : "Sell"}</Badge>
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {m?.name ?? o.coin} <span className="text-muted">{o.orderType}</span>
                  </span>
                  <span className="text-muted tabular-nums">
                    {/* Position TP/SL report size 0: they close whatever the position is. */}
                    {Number(o.sz) === 0 && o.isPositionTpsl ? "Position" : fmtSize(o.sz)} @{" "}
                    {o.isTrigger ? `trigger ${fmtPrice(o.triggerPx)}` : fmtPrice(o.limitPx)}
                    {o.reduceOnly && " · reduce"}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={!m || cancel.isPending}
                  onClick={() => m && cancel.mutate({ a: m.assetId, o: o.oid })}
                >
                  Cancel
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {(cancel.isError || cancelAll.isError) && (
        <div className="mt-2">
          <Notice tone="error">{errorMessage(cancel.error ?? cancelAll.error)}</Notice>
        </div>
      )}
    </Card>
  );
}
