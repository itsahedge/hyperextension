import type { ClearinghouseStateResponse } from "@nktkas/hyperliquid/api/info";
import { useState } from "react";
import { SpotBalancesCard } from "@/components/SpotBalances";
import { Badge, Button, Card, ConfirmDialog, Empty, Loading, Notice, Stat, errorMessage } from "@/components/ui";
import { allPositions, isUnified, useAbstraction, useAccountValue, useExchange, useMarketData, usePerpStates, useSpotState } from "@/hooks/queries";
import { useUnlocked } from "@/hooks/session";
import { fmtPct, fmtPrice, fmtSignedUsd, fmtSize, fmtUsd, toneOf } from "@/lib/format";
import type { Market } from "@/lib/markets";
import { freeBalance, spotUsdValue } from "@/lib/markets";
import { buildClose, DEFAULT_SLIPPAGE } from "@/lib/orders";
import { assertAccepted, submitOrders } from "@/lib/placement";

type Position = ClearinghouseStateResponse["assetPositions"][number]["position"];

// "default" (new accounts) keeps separate perp and spot balances like
// "disabled"; "dexAbstraction" is a discontinued mode.
const MODE_LABEL: Record<string, string> = {
  unifiedAccount: "Unified",
  portfolioMargin: "Portfolio margin",
  disabled: "Standard",
  default: "Standard",
  dexAbstraction: "DEX abstraction",
};

export function Portfolio() {
  const { config } = useUnlocked();
  const perp = usePerpStates();
  const spot = useSpotState();
  const markets = useMarketData(config.network);
  const mode = useAbstraction();
  const accountValue = useAccountValue();

  if (perp.isPending || spot.isPending) return <Loading />;
  if (perp.isError) return <Notice tone="error">{errorMessage(perp.error)}</Notice>;
  if (spot.isError) return <Notice tone="error">{errorMessage(spot.error)}</Notice>;

  const unified = isUnified(mode.data);
  const spotValue = markets.data ? spotUsdValue(spot.data.balances, markets.data.markets) : null;
  // Every perp dex, main and HIP-3.
  const positions = allPositions(perp.data);
  const sum = (f: (p: Position) => number) => positions.reduce((a, p) => a + f(p), 0);
  const totalPnl = sum((p) => Number(p.unrealizedPnl));
  const usdc = spot.data.balances.find((b) => b.coin === "USDC");
  const main = perp.data.find(([dex]) => dex === "")?.[1];
  // Standard mode only: per-dex perp balances are not meaningful when unified.
  const perpEquity = perp.data.reduce((a, [, st]) => a + Number(st.marginSummary.accountValue), 0);

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[11px] text-muted">Total value</p>
            <p className="text-2xl font-semibold tabular-nums">{accountValue.data == null ? "…" : fmtUsd(accountValue.data)}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {unified ? (
              <Stat label="Account" value={MODE_LABEL[mode.data!] ?? mode.data} />
            ) : (
              <Stat label="Perp equity" value={fmtUsd(perpEquity)} />
            )}
            <Stat label="Spot" value={spotValue === null ? "…" : fmtUsd(spotValue)} />
            <Stat label="Unrealized PnL" value={fmtSignedUsd(totalPnl)} tone={toneOf(totalPnl)} />
            {unified ? (
              <Stat label="Available USDC" value={fmtUsd(usdc ? freeBalance(usdc) : 0)} />
            ) : (
              <Stat label="Withdrawable" value={fmtUsd(main?.withdrawable ?? 0)} />
            )}
            <Stat label="Margin used" value={fmtUsd(sum((p) => Number(p.marginUsed)))} />
            <Stat label="Notional" value={fmtUsd(sum((p) => Math.abs(Number(p.positionValue))))} />
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
