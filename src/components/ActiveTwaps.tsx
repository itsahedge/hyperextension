import { Badge, Button, Card, Notice, errorMessage } from "@/components/ui";
import { useActiveTwaps, useExchange } from "@/hooks/queries";
import { fmtSize } from "@/lib/format";
import type { Market } from "@/lib/markets";

export function ActiveTwaps({ byCoin }: { byCoin: Map<string, Market> }) {
  const twaps = useActiveTwaps();
  const cancel = useExchange((client, t: { a: number; t: number }) => client.twapCancel(t));
  const rows = twaps.data ?? [];
  if (rows.length === 0 && !twaps.isError) return null;

  return (
    <Card title={`Active TWAPs (${rows.length})`}>
      {twaps.isError && <Notice tone="error">{errorMessage(twaps.error)}</Notice>}
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((row) => {
          const m = byCoin.get(row.state.coin);
          const done = Number(row.state.sz) > 0 ? Number(row.state.executedSz) / Number(row.state.sz) : 0;
          return (
            <li key={row.twapId} className="flex items-center gap-2 py-2 text-xs first:pt-0 last:pb-0">
              <Badge tone={row.state.side === "B" ? "up" : "down"}>{row.state.side === "B" ? "Buy" : "Sell"}</Badge>
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {m?.name ?? row.state.coin} <span className="text-muted">{row.state.minutes}m TWAP</span>
                </span>
                <span className="text-muted tabular-nums">
                  {fmtSize(row.state.executedSz)} / {fmtSize(row.state.sz)} ({Math.round(done * 100)}%)
                  {row.status.status === "waitingForTrigger" && " · waiting for trigger"}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                disabled={!m || row.twapId === undefined || cancel.isPending}
                onClick={() => m && row.twapId !== undefined && cancel.mutate({ a: m.assetId, t: row.twapId })}
              >
                Cancel
              </Button>
            </li>
          );
        })}
      </ul>
      {cancel.isError && (
        <div className="mt-2">
          <Notice tone="error">{errorMessage(cancel.error)}</Notice>
        </div>
      )}
    </Card>
  );
}
