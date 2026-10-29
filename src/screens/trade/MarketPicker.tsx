import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react";
import { useMemo, useState } from "react";
import { Stat, cx } from "@/components/ui";
import { fmtCompactUsd, fmtPct, fmtPrice, fmtRate, toneOf } from "@/lib/format";
import type { Market } from "@/lib/markets";

export function MarketPicker({ markets, value, onChange }: { markets: Market[]; value: Market; onChange: (m: Market) => void }) {
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

export function MarketHeader({ market: m }: { market: Market }) {
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
