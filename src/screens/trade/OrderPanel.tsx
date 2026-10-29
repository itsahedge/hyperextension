import type { ExchangeClient } from "@nktkas/hyperliquid";
import { useEffect, useState } from "react";
import { Card, Notice, cx, errorMessage } from "@/components/ui";
import { useActiveAsset, useExchange, usePerpState, usePrefs, useSpotState } from "@/hooks/queries";
import { maxSizes, planEntry, POST_TYPES, referencePrice, TPSL_TYPES, type EntryPlan, type PanelState } from "@/lib/entry";
import { fmtPrice, fmtSize, fmtUsd } from "@/lib/format";
import { freeBalance, type Market } from "@/lib/markets";
import { describeSummary, submitOrders, type PlacementSummary } from "@/lib/placement";
import { OrderTypeMenu, SizeControl, Toggle } from "./controls";
import { LimitFields, ScaleFields, ScaleSideFields, StopFields, SwarmFields, TpSlFields, TwapFields, type LadderView } from "./fields";
import { PanelFooter } from "./footer";

type Outcome = { kind: "orders"; summary: PlacementSummary } | { kind: "twap"; twapId: number };

async function execute(client: ExchangeClient, plan: EntryPlan): Promise<Outcome> {
  if (plan.kind === "twap") {
    const res = await client.twapOrder(plan.params);
    return { kind: "twap", twapId: res.response.data.status.running.twapId };
  }
  return { kind: "orders", summary: await submitOrders(client, plan.orders, plan.grouping) };
}

function tryPlan(s: PanelState, ctx: Parameters<typeof planEntry>[1], isBuy: boolean) {
  try {
    return { plan: planEntry(s, ctx, isBuy), error: null };
  } catch (err) {
    return { plan: null, error: errorMessage(err) };
  }
}

function previewLabel(plan: EntryPlan | null, s: PanelState): string {
  if (!plan) return "—";
  const p = plan.preview;
  if (plan.kind === "twap") return `${fmtSize(p.size)} over ${s.minutes}m`;
  if (p.avgPx !== null) return `${p.orderCount} orders · ${fmtSize(p.size)} avg ${fmtPrice(p.avgPx)}`;
  if (p.orderCount > 1) return `${p.orderCount} lots · ${fmtSize(p.size)}`;
  return `${fmtSize(p.size)} @ ${p.price === null ? "—" : fmtPrice(p.price)}`;
}

export function OrderPanel({
  market,
  book,
  s,
  set,
}: {
  market: Market;
  book: { bid: number; ask: number } | undefined;
  s: PanelState;
  set: (patch: Partial<PanelState>) => void;
}) {
  const isPerp = market.kind === "perp";
  const asset = useActiveAsset(isPerp ? market.coin : null);
  const perp = usePerpState();
  const spot = useSpotState();
  const prefs = usePrefs();
  const slippage = prefs.data?.slippage ?? 0.01;
  const ctx = { market, book: book && book.bid > 0 ? book : undefined, slippage };
  const refPx = referencePrice(s, ctx);

  const position = Number(perp.data?.assetPositions.find((p) => p.position.coin === market.coin)?.position.szi ?? 0);
  const [baseToken, quoteToken] = isPerp ? [market.name, "USDC"] : market.name.split("/");
  const spotFree = (coin: string | undefined) => {
    const b = spot.data?.balances.find((x) => x.coin === coin);
    return b ? freeBalance(b) : 0;
  };
  const maxes = maxSizes(s, ctx, {
    // Inferred from live data, not documented: index 0 is the buy side, 1 the
    // sell side (a long's sell max exceeds its buy max by twice the position).
    // Only sizes the slider; the exchange still validates every order.
    perpMax: asset.data ? { buy: Number(asset.data.maxTradeSzs[0]), sell: Number(asset.data.maxTradeSzs[1]) } : undefined,
    position,
    spotQuote: spotFree(quoteToken),
    spotBase: spotFree(baseToken),
  });
  const sliderMax = Math.max(maxes.buy, maxes.sell);
  const available = isPerp ? Number(perp.data?.withdrawable ?? 0) : spotFree(quoteToken);

  const buy = tryPlan(s, ctx, true);
  const sell = tryPlan(s, ctx, false);
  const shown = buy.plan ?? sell.plan;
  const ladder: LadderView | null =
    shown && shown.kind === "orders" && (s.type === "scale" || s.type === "scaleSide")
      ? (() => {
          const rungs = shown.orders.map((o) => ({ px: String(o.p), sz: String(o.s) })).sort((a, b) => Number(a.px) - Number(b.px));
          return { rungs, low: Number(rungs[0]!.px), high: Number(rungs.at(-1)!.px), avgPx: shown.preview.avgPx ?? 0, warnings: shown.preview.warnings };
        })()
      : null;

  const [lastError, setLastError] = useState<string | null>(null);
  const submit = useExchange((client, v: { plan: EntryPlan; isBuy: boolean }) => execute(client, v.plan));
  // A result belongs to the order that produced it; clear it when the order
  // type or market changes.
  const { reset } = submit;
  useEffect(() => {
    reset();
    setLastError(null);
  }, [s.type, market.coin, reset]);

  const place = (isBuy: boolean) => {
    submit.reset();
    const attempt = isBuy ? buy : sell;
    if (!attempt.plan) {
      setLastError(attempt.error);
      return;
    }
    setLastError(null);
    submit.mutate({ plan: attempt.plan, isBuy });
  };

  const fields = { s, set, market, book: ctx.book };
  const tpslAllowed = isPerp && TPSL_TYPES.includes(s.type);
  const outcome = submit.data;
  const outcomeTone = outcome?.kind === "orders" && outcome.summary.errors.length ? (outcome.summary.errors.length === outcome.summary.total ? "error" : "warn") : "success";

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <OrderTypeMenu value={s.type} onChange={(type) => set({ type })} market={market} />
        <SizeControl market={market} size={s.size} onSize={(size) => set({ size })} refPx={refPx} max={sliderMax} />

        {s.type === "limit" && <LimitFields {...fields} />}
        {s.type === "limitStop" && <StopFields {...fields} withLimit />}
        {s.type === "marketStop" && <StopFields {...fields} withLimit={false} />}
        {s.type === "scale" && <ScaleFields {...fields} ladder={ladder} />}
        {s.type === "scaleSide" && <ScaleSideFields {...fields} ladder={ladder} />}
        {s.type === "swarm" && <SwarmFields {...fields} />}
        {s.type === "twap" && <TwapFields {...fields} />}

        <div className="flex gap-1 border-t border-line pt-2">
          {POST_TYPES.includes(s.type) && (
            <Toggle on={s.post} onChange={(post) => set({ post })}>
              Post
            </Toggle>
          )}
          {isPerp && (
            <Toggle on={s.reduce} onChange={(reduce) => set({ reduce })}>
              Reduce
            </Toggle>
          )}
          {tpslAllowed && (
            <Toggle on={s.tpsl} onChange={(tpsl) => set({ tpsl })}>
              TP/SL
            </Toggle>
          )}
        </div>
        {tpslAllowed && s.tpsl && <TpSlFields s={s} set={set} refPx={refPx} limitEntry={s.type === "limit"} />}

        <div className="grid grid-cols-2 gap-2">
          <SideButton
            label={isPerp ? "Long" : "Buy"}
            tone="up"
            sub={previewLabel(buy.plan, s)}
            over={buy.plan !== null && buy.plan.preview.size > maxes.buy * 1.0001}
            busy={submit.isPending && submit.variables?.isBuy === true}
            disabled={submit.isPending}
            onClick={() => place(true)}
          />
          <SideButton
            label={isPerp ? "Short" : "Sell"}
            tone="down"
            sub={previewLabel(sell.plan, s)}
            over={sell.plan !== null && sell.plan.preview.size > maxes.sell * 1.0001}
            busy={submit.isPending && submit.variables?.isBuy === false}
            disabled={submit.isPending}
            onClick={() => place(false)}
          />
        </div>

        {lastError && <Notice tone="error">{lastError}</Notice>}
        {submit.isError && <Notice tone="error">{errorMessage(submit.error)}</Notice>}
        {outcome && (
          <Notice tone={outcomeTone}>{outcome.kind === "twap" ? `TWAP running (#${outcome.twapId})` : describeSummary(outcome.summary)}</Notice>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Box label="Total" value={shown ? fmtUsd(shown.preview.notional) : "—"} />
          <Box label="Available" value={fmtUsd(available)} />
        </div>
        <PanelFooter market={market} leverage={asset.data?.leverage} slippage={slippage} />
      </div>
    </Card>
  );
}

function SideButton({
  label,
  tone,
  sub,
  over,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  tone: "up" | "down";
  sub: string;
  over: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy || undefined}
      className={cx(
        "flex flex-col items-center gap-0.5 rounded-md py-2.5 font-semibold tracking-wide uppercase transition-[filter] duration-150 hover:brightness-110 disabled:opacity-60",
        tone === "up" ? "bg-up/25 text-up" : "bg-down/25 text-down",
      )}
    >
      <span className="text-sm">{busy ? "Sending…" : label}</span>
      <span className={cx("text-[10px] font-normal normal-case tabular-nums", over ? "text-warn" : "text-fg/70")}>{over ? `${sub} · over max` : sub}</span>
    </button>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center rounded-md border border-line py-1.5">
      <span className="text-[10px] text-muted">{label}</span>
      <span className="text-xs font-medium tabular-nums">{value}</span>
    </div>
  );
}
