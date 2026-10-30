import type { ClearinghouseStateResponse } from "@nktkas/hyperliquid/api/info";
import { useState } from "react";
import { SpotBalancesCard } from "@/components/SpotBalances";
import { Badge, Button, Card, ConfirmDialog, Empty, Loading, Notice, Stat, errorMessage } from "@/components/ui";
import { useExchange, useMarketData, usePerpState, useSpotState } from "@/hooks/queries";
import { useUnlocked } from "@/hooks/session";
import { fmtPct, fmtPrice, fmtSignedUsd, fmtSize, fmtUsd, toneOf } from "@/lib/format";
import type { Market } from "@/lib/markets";
import { spotUsdValue } from "@/lib/markets";
import { buildClose, DEFAULT_SLIPPAGE } from "@/lib/orders";
import { assertAccepted, submitOrders } from "@/lib/placement";

type Position = ClearinghouseStateResponse["assetPositions"][number]["position"];

export function Portfolio() {
  const { config } = useUnlocked();
  const perp = usePerpState();
  const spot = useSpotState();
  const markets = useMarketData(config.network);

  if (perp.isPending || spot.isPending) return <Loading />;
  if (perp.isError) return <Notice tone="error">{errorMessage(perp.error)}</Notice>;
  if (spot.isError) return <Notice tone="error">{errorMessage(spot.error)}</Notice>;

  const perpValue = Number(perp.data.marginSummary.accountValue);
  const spotValue = markets.data ? spotUsdValue(spot.data.balances, markets.data.markets) : null;
  const positions = perp.data.assetPositions.map((p) => p.position);
  const totalPnl = positions.reduce((sum, p) => sum + Number(p.unrealizedPnl), 0);

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[11px] text-muted">Total value</p>
            <p className="text-2xl font-semibold tabular-nums">
              {spotValue === null ? fmtUsd(perpValue) : fmtUsd(perpValue + spotValue)}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Perp equity" value={fmtUsd(perpValue)} />
            <Stat label="Spot" value={spotValue === null ? "…" : fmtUsd(spotValue)} />
            <Stat label="Unrealized PnL" value={fmtSignedUsd(totalPnl)} tone={toneOf(totalPnl)} />
            <Stat label="Withdrawable" value={fmtUsd(perp.data.withdrawable)} />
            <Stat label="Margin used" value={fmtUsd(perp.data.marginSummary.totalMarginUsed)} />
            <Stat label="Notional" value={fmtUsd(perp.data.marginSummary.totalNtlPos)} />
          </div>
        </div>
      </Card>

      <SpotBalancesCard balances={spot.data.balances} markets={markets.data?.markets} />

      <Card title={`Perp positions (${positions.length})`}>
        {positions.length === 0 ? (
          <Empty>No open positions</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {positions.map((p) => (
              <PositionRow key={p.coin} position={p} market={markets.data?.byCoin.get(p.coin)} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PositionRow({ position: p, market }: { position: Position; market: Market | undefined }) {
  const [confirming, setConfirming] = useState(false);
  const close = useExchange(async (client, m: Market) => assertAccepted(await submitOrders(client, [buildClose(m, p.szi)])));
  const isLong = Number(p.szi) > 0;

  return (
    <li className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{market?.label ?? p.coin}</span>
        <Badge tone={isLong ? "up" : "down"}>
          {isLong ? "Long" : "Short"} {p.leverage.value}x {p.leverage.type === "isolated" ? "iso" : ""}
        </Badge>
        <span className={`ml-auto font-medium tabular-nums ${toneOf(p.unrealizedPnl)}`}>
          {fmtSignedUsd(p.unrealizedPnl)} <span className="text-xs">({fmtPct(p.returnOnEquity)})</span>
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs">
        <Stat label="Size" value={fmtSize(Math.abs(Number(p.szi)))} />
        <Stat label="Entry" value={fmtPrice(p.entryPx)} />
        <Stat label="Mark" value={market ? fmtPrice(market.markPx) : "…"} />
        <Stat label="Liq." value={p.liquidationPx ? fmtPrice(p.liquidationPx) : "-"} />
      </div>
      {close.isError && <Notice tone="error">{errorMessage(close.error)}</Notice>}
      <div className="flex justify-end">
        <Button size="sm" variant="danger" disabled={!market} onClick={() => setConfirming(true)}>
          Market close
        </Button>
      </div>
      {market && (
        <ConfirmDialog
          open={confirming}
          onClose={() => setConfirming(false)}
          title={`Close ${market?.label ?? p.coin} position`}
          confirmLabel="Close position"
          variant="danger"
          onConfirm={() => close.mutateAsync(market)}
        >
          Sends a reduce-only market {isLong ? "sell" : "buy"} for {fmtSize(Math.abs(Number(p.szi)))} {market?.name ?? p.coin}, at most{" "}
          {DEFAULT_SLIPPAGE * 100}% from the mid price. Any unfilled part is cancelled.
        </ConfirmDialog>
      )}
    </li>
  );
}
