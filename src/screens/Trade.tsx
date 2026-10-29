import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react";
import type { OrderSuccessResponse } from "@nktkas/hyperliquid/api/exchange";
import { useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Card, Empty, Loading, Notice, Segmented, Stat, TextField, cx, errorMessage } from "@/components/ui";
import { useExchange, useMarketData, useOpenOrders } from "@/hooks/queries";
import { useUnlocked } from "@/hooks/session";
import { fmtCompactUsd, fmtPct, fmtPrice, fmtRate, fmtSize, fmtUsd, toneOf } from "@/lib/format";
import type { Market, MarketKind } from "@/lib/markets";
import { buildOrder, DEFAULT_SLIPPAGE, type LimitTif, type OrderType } from "@/lib/orders";

export function Trade() {
  const { config } = useUnlocked();
  const data = useMarketData(config.network);
  const [kind, setKind] = useState<MarketKind>("perp");
  const [coin, setCoin] = useState<Record<MarketKind, string | null>>({ perp: null, spot: null });

  if (data.isPending) return <Loading />;
  if (data.isError) return <Notice tone="error">{errorMessage(data.error)}</Notice>;

  const list = data.data.markets.filter((m) => m.kind === kind);
  const selected = data.data.byCoin.get(coin[kind] ?? "") ?? list[0];

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="Market type"
        value={kind}
        onChange={setKind}
        options={[
          { value: "perp", label: "Perps" },
          { value: "spot", label: "Spot" },
        ]}
      />
      {selected ? (
        <>
          <MarketPicker markets={list} value={selected} onChange={(m) => setCoin((c) => ({ ...c, [kind]: m.coin }))} />
          <MarketHeader market={selected} />
          <OrderForm key={selected.coin} market={selected} />
        </>
      ) : (
        <Empty>No markets</Empty>
      )}
      <OpenOrders byCoin={data.data.byCoin} />
    </div>
  );
}

function MarketPicker({ markets, value, onChange }: { markets: Market[]; value: Market; onChange: (m: Market) => void }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return (q ? markets.filter((m) => m.name.toUpperCase().includes(q)) : markets).slice(0, 50);
  }, [markets, query]);

  return (
    <Combobox value={value} onChange={(m: Market | null) => m && onChange(m)} onClose={() => setQuery("")} by="coin">
      <div className="relative">
        <ComboboxInput
          aria-label="Market"
          className="h-9 w-full rounded-md border border-line bg-surface pr-8 pl-2.5 font-semibold outline-none focus:border-accent"
          displayValue={(m: Market | null) => m?.name ?? ""}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
        <ComboboxButton aria-label="Show markets" className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted hover:text-fg">
          <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </ComboboxButton>
        <ComboboxOptions className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-md border border-line bg-raised p-1 shadow-lg empty:invisible">
          {filtered.map((m) => (
            <ComboboxOption
              key={m.coin}
              value={m}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs data-focus:bg-line"
            >
              <span className="font-medium">{m.name}</span>
              <span className="ml-auto tabular-nums">{fmtPrice(m.markPx)}</span>
              <span className={cx("w-14 text-right tabular-nums", toneOf(m.markPx - m.prevDayPx))}>
                {m.prevDayPx ? fmtPct(m.markPx / m.prevDayPx - 1) : "-"}
              </span>
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      </div>
    </Combobox>
  );
}

function MarketHeader({ market: m }: { market: Market }) {
  const change = m.prevDayPx ? m.markPx / m.prevDayPx - 1 : 0;
  return (
    <div className="grid grid-cols-4 gap-2 rounded-lg border border-line bg-surface p-3">
      <Stat label="Mark" value={fmtPrice(m.markPx)} />
      <Stat label="24h" value={fmtPct(change)} tone={toneOf(change)} />
      <Stat label="Volume" value={fmtCompactUsd(m.dayNtlVlm)} />
      {m.funding !== null ? (
        <Stat label="Funding/h" value={fmtRate(m.funding)} tone={toneOf(m.funding)} />
      ) : (
        <Stat label="Size step" value={`${m.szDecimals} dp`} />
      )}
    </div>
  );
}

function describeResult(res: OrderSuccessResponse): string {
  const status = res.response.data.statuses[0];
  if (!status) return "Submitted";
  if (typeof status === "string") return status === "waitingForTrigger" ? "Waiting for trigger" : "Waiting for fill";
  // Error statuses never reach here: the SDK throws ApiRequestError for them.
  if ("filled" in status) return `Filled ${status.filled.totalSz} at ${fmtPrice(status.filled.avgPx)}`;
  return `Order resting (#${status.resting.oid})`;
}

function OrderForm({ market }: { market: Market }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<OrderType>("market");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [tif, setTif] = useState<LimitTif>("Gtc");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [slippagePct, setSlippagePct] = useState(String(DEFAULT_SLIPPAGE * 100));
  const [formError, setFormError] = useState<string | null>(null);

  const place = useExchange((client, order: ReturnType<typeof buildOrder>) =>
    client.order({ orders: [order], grouping: "na" }),
  );

  const isPerp = market.kind === "perp";
  const refPrice = type === "limit" && Number(price) > 0 ? Number(price) : market.markPx;
  const notional = Number(size) > 0 ? Number(size) * refPrice : null;
  const [base] = market.name.split("/");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    place.reset();
    let order;
    try {
      order = buildOrder({
        market,
        isBuy: side === "buy",
        size,
        type,
        price,
        tif,
        reduceOnly,
        slippage: Number(slippagePct) / 100,
      });
    } catch (err) {
      setFormError(errorMessage(err));
      return;
    }
    await place.mutateAsync(order).catch(() => {});
  };

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Segmented
          label="Side"
          value={side}
          onChange={setSide}
          tone={(v) => (v === "buy" ? "text-up!" : "text-down!")}
          options={[
            { value: "buy", label: isPerp ? "Long" : "Buy" },
            { value: "sell", label: isPerp ? "Short" : "Sell" },
          ]}
        />
        <Segmented
          label="Order type"
          value={type}
          onChange={setType}
          options={[
            { value: "market", label: "Market" },
            { value: "limit", label: "Limit" },
          ]}
        />

        {type === "limit" ? (
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <TextField
              label="Price"
              inputMode="decimal"
              value={price}
              placeholder={fmtPrice(market.markPx)}
              onChange={(e) => setPrice(e.target.value)}
              suffix="USDC"
            />
            <div className="w-28">
              <Segmented
                label="Time in force"
                value={tif}
                onChange={setTif}
                options={[
                  { value: "Gtc", label: "GTC" },
                  { value: "Alo", label: "Post" },
                ]}
              />
            </div>
          </div>
        ) : (
          <TextField
            label="Max slippage"
            inputMode="decimal"
            value={slippagePct}
            onChange={(e) => setSlippagePct(e.target.value)}
            suffix="%"
          />
        )}

        <TextField
          label="Size"
          inputMode="decimal"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          suffix={base}
          hint={notional !== null ? `≈ ${fmtUsd(notional)}` : `Step ${(10 ** -market.szDecimals).toFixed(market.szDecimals)}`}
        />

        {isPerp && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={reduceOnly}
              onChange={(e) => setReduceOnly(e.target.checked)}
              className="size-3.5 accent-(--color-accent)"
            />
            Reduce only
          </label>
        )}

        {formError && <Notice tone="error">{formError}</Notice>}
        {place.isError && <Notice tone="error">{errorMessage(place.error)}</Notice>}
        {place.isSuccess && <Notice tone="success">{describeResult(place.data)}</Notice>}

        <Button type="submit" variant={side === "buy" ? "buy" : "sell"} busy={place.isPending} disabled={!size}>
          {side === "buy" ? (isPerp ? "Long" : "Buy") : isPerp ? "Short" : "Sell"} {base}
        </Button>
      </form>
      {isPerp && <LeverageForm market={market} />}
    </Card>
  );
}

function LeverageForm({ market }: { market: Market }) {
  const [leverage, setLeverage] = useState("");
  const [margin, setMargin] = useState<"cross" | "isolated">("cross");
  const update = useExchange((client, value: number) =>
    client.updateLeverage({ asset: market.assetId, isCross: margin === "cross", leverage: value }),
  );
  const max = market.maxLeverage ?? 1;
  const value = Number(leverage);
  const invalid = leverage !== "" && (!Number.isInteger(value) || value < 1 || value > max);

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
      <div className="grid grid-cols-[1fr_8rem] items-end gap-2">
        <TextField
          label="Leverage"
          inputMode="numeric"
          value={leverage}
          placeholder={`1-${max}`}
          onChange={(e) => setLeverage(e.target.value)}
          suffix="x"
          error={invalid ? `Whole number from 1 to ${max}` : null}
        />
        <Segmented
          label="Margin mode"
          value={margin}
          onChange={setMargin}
          options={[
            { value: "cross", label: "Cross" },
            { value: "isolated", label: "Iso" },
          ]}
        />
      </div>
      {update.isError && <Notice tone="error">{errorMessage(update.error)}</Notice>}
      {update.isSuccess && (
        <Notice tone="success">
          {market.name} set to {value}x {margin}
        </Notice>
      )}
      <Button
        variant="secondary"
        busy={update.isPending}
        disabled={!leverage || invalid}
        onClick={() => update.mutate(value)}
      >
        Set leverage
      </Button>
    </div>
  );
}

function OpenOrders({ byCoin }: { byCoin: Map<string, Market> }) {
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
                    {fmtSize(o.sz)} @ {o.isTrigger ? `trigger ${fmtPrice(o.triggerPx)}` : fmtPrice(o.limitPx)}
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
