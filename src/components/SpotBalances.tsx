import { fmtSize, fmtUsd } from "@/lib/format";
import { spotHoldings, type Market } from "@/lib/markets";
import { Card, Empty } from "./ui";

export function SpotBalancesCard({
  balances,
  markets,
}: {
  balances: { coin: string; total: string; hold: string }[];
  // Undefined while market data loads; amounts still render, values show "…".
  markets: Market[] | undefined;
}) {
  const holdings = spotHoldings(balances, markets ?? []);

  return (
    <Card title={`Spot balances (${holdings.length})`}>
      {holdings.length === 0 ? (
        <Empty>No spot balances</Empty>
      ) : (
        <table className="w-full text-xs tabular-nums">
          <thead className="text-[11px] text-faint">
            <tr>
              <th className="pb-1 text-left font-normal">Asset</th>
              <th className="pb-1 text-right font-normal">Total</th>
              <th className="pb-1 text-right font-normal">Available</th>
              <th className="pb-1 text-right font-normal">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {holdings.map((h) => (
              <tr key={h.coin}>
                <td className="py-1.5 font-medium">{h.coin}</td>
                <td className="py-1.5 text-right">{fmtSize(h.total)}</td>
                <td className="py-1.5 text-right">{fmtSize(h.available)}</td>
                <td className="py-1.5 pl-2 text-right text-muted">{!markets ? "…" : h.usd === null ? "-" : fmtUsd(h.usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
