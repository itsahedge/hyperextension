import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react";
import { useMemo, useState } from "react";
import { Stat, cx } from "@/components/ui";
import { withFavoritesFirst } from "@/lib/favorites";
import { fmtCompactUsd, fmtPct, fmtPrice, fmtRate, fmtSize, toneOf } from "@/lib/format";
import type { Market } from "@/lib/markets";

export function StarButton({ on, onToggle, label, className }: { on: boolean; onToggle: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      aria-label={on ? `Unfavorite ${label}` : `Favorite ${label}`}
      aria-pressed={on}
      // Headless UI's ComboboxOption selects on mousedown; stop it reaching the
      // option, and prevent the default so the input keeps focus and the list
      // stays open.
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={cx("flex size-6 shrink-0 items-center justify-center rounded hover:bg-line", on ? "text-warn" : "text-faint hover:text-fg", className)}
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
        <path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6Z" />
      </svg>
    </button>
  );
}

function MarketRow({ m, favorite, onToggle }: { m: Market; favorite: boolean; onToggle: () => void }) {
  return (
    <ComboboxOption value={m} className="flex cursor-pointer items-center gap-1.5 rounded py-1 pr-2 pl-0.5 text-xs data-focus:bg-line">
      <StarButton on={favorite} onToggle={onToggle} label={m.label} />
      <span className="font-medium">{m.name}</span>
      {m.dex && <span className="rounded bg-raised px-1 text-[10px] text-muted">{m.dex}</span>}
      <span className="ml-auto tabular-nums">{fmtPrice(m.markPx)}</span>
      <span className={cx("w-14 text-right tabular-nums", toneOf(m.markPx - m.prevDayPx))}>
        {m.prevDayPx ? fmtPct(m.markPx / m.prevDayPx - 1) : "-"}
      </span>
    </ComboboxOption>
  );
}

export function MarketPicker({
  markets,
  value,
  onChange,
  favorites,
  onToggleFavorite,
}: {
  markets: Market[];
  value: Market;
  onChange: (m: Market) => void;
  favorites: string[];
  onToggleFavorite: (coin: string) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toUpperCase();
    const matching = q ? markets.filter((m) => m.label.toUpperCase().includes(q) || m.coin.toUpperCase().includes(q)) : markets;
    const { favorites: favs, rest } = withFavoritesFirst(matching, favorites);
    return { favs, rest: rest.slice(0, 50) };
  }, [markets, query, favorites]);
  const isFav = (coin: string) => favorites.includes(coin);

  return (
    <Combobox value={value} onChange={(m: Market | null) => m && onChange(m)} onClose={() => setQuery("")} by="coin">
      <div className="relative">
        <ComboboxInput
          aria-label="Market"
          className="h-9 w-full rounded-md border border-line bg-surface pr-14 pl-2.5 font-semibold outline-none focus:border-accent"
          displayValue={(m: Market | null) => m?.label ?? ""}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
        <StarButton on={isFav(value.coin)} onToggle={() => onToggleFavorite(value.coin)} label={value.label} className="absolute top-1.5 right-8" />
        <ComboboxButton aria-label="Show markets" className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted hover:text-fg">
          <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </ComboboxButton>
        <ComboboxOptions className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-md border border-line bg-raised p-1 shadow-lg empty:invisible">
          {groups.favs.length > 0 && (
            <>
              <div role="presentation" className="px-2 pt-1 pb-0.5 text-[10px] tracking-wide text-muted uppercase">
                Favorites
              </div>
              {groups.favs.map((m) => (
                <MarketRow key={m.coin} m={m} favorite onToggle={() => onToggleFavorite(m.coin)} />
              ))}
              {groups.rest.length > 0 && (
                <div role="presentation" className="mt-1 border-t border-line px-2 pt-1.5 pb-0.5 text-[10px] tracking-wide text-muted uppercase">
                  All markets
                </div>
              )}
            </>
          )}
          {groups.rest.map((m) => (
            <MarketRow key={m.coin} m={m} favorite={false} onToggle={() => onToggleFavorite(m.coin)} />
          ))}
        </ComboboxOptions>
      </div>
    </Combobox>
  );
}

// One-tap switching between favorites of the current market type.
export function FavoriteChips({ markets, value, onChange }: { markets: Market[]; value: Market; onChange: (m: Market) => void }) {
  if (markets.length === 0) return null;
  return (
    <div className="-mt-1 flex gap-1.5 overflow-x-auto pb-0.5" aria-label="Favorite markets">
      {markets.map((m) => (
        <button
          key={m.coin}
          type="button"
          aria-pressed={m.coin === value.coin}
          onClick={() => onChange(m)}
          className={cx(
            "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
            m.coin === value.coin ? "border-accent text-accent" : "border-line text-muted hover:text-fg",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function MarketHeader({ market: m }: { market: Market }) {
  const change = m.prevDayPx ? m.markPx / m.prevDayPx - 1 : 0;
  const isPerp = m.openInterest !== null;
  return (
    // Perps show five stats; content-sized columns fit them where equal
    // columns would clip the funding rate.
    <div className={cx("gap-2 rounded-lg border border-line bg-surface p-3", isPerp ? "flex justify-between" : "grid grid-cols-4")}>
      <Stat label="Mark" value={fmtPrice(m.markPx)} />
      <Stat label="24h" value={fmtPct(change)} tone={toneOf(change)} />
      <Stat label="Volume" value={fmtCompactUsd(m.dayNtlVlm)} />
      {m.openInterest !== null && (
        <Stat
          label="Open int."
          value={<span title={`${fmtSize(m.openInterest, 2)} ${m.name}`}>{fmtCompactUsd(m.openInterest * m.markPx)}</span>}
        />
      )}
      {m.funding !== null ? (
        <Stat label="Funding/h" value={fmtRate(m.funding)} tone={toneOf(m.funding)} />
      ) : (
        <Stat label="Size step" value={`${m.szDecimals} dp`} />
      )}
    </div>
  );
}

const MARGIN_MODE: Record<string, string> = { noCross: "Isolated only", strictIsolated: "Strict isolated (margin can't be removed)" };

// HIP-3 markets: who deployed them and how they differ from main perps.
// Fees per the trade[XYZ] fee docs: 2x the validator-operated perp rates,
// cut by at least 90% under growth mode.
export function Hip3Details({ market: m }: { market: Market }) {
  if (!m.dex) return null;
  const parts = [
    `HIP-3 · ${m.dex} dex`,
    `${m.collateral} collateral`,
    MARGIN_MODE[m.marginMode ?? ""],
    m.growthMode ? "Growth mode: fees at least 90% lower" : "Fees 2x standard perps",
  ].filter(Boolean);
  return <p className="-mt-1 px-1 text-[11px] text-faint">{parts.join(" · ")}</p>;
}
