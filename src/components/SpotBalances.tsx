import { fmtSize, fmtUsd } from "@/lib/format";
import { spotHoldings, type Market } from "@/lib/markets";
import { Card, Empty } from "./ui";

export function SpotBalancesCard({
  balances,
  markets,
}: {
  balances: { coin: string; total: string }[];
  // Undefined while market data loads; amounts still render, values show "…".
  markets: Market[] | undefined;
}) {
  const holdings = spotHoldings(balances, markets ?? []);

  return (
    <Card title={`Spot balances (${holdings.length})`}>
      {holdings.length === 0 ? (
        <Empty>No spot balances</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-xs">
          {holdings.map((h) => (
            <li key={h.coin} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
              <span className="font-medium">{h.coin}</span>
              <span className="ml-auto tabular-nums">{fmtSize(h.total)}</span>
              <span className="min-w-20 text-right text-muted tabular-nums">
                {!markets ? "…" : h.usd === null ? "-" : fmtUsd(h.usd)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
