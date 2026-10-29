import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useState, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { ORDER_TYPES, type OrderTypeId } from "@/lib/entry";
import { fmtUsd } from "@/lib/format";
import type { Market } from "@/lib/markets";
import { sizeAtFraction, usdToBase } from "@/lib/sizing";

export function OrderTypeMenu({ value, onChange, market }: { value: OrderTypeId; onChange: (t: OrderTypeId) => void; market: Market }) {
  const current = ORDER_TYPES.find((t) => t.id === value)!;
  return (
    <Menu as="div" className="relative">
      <MenuButton className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-3 text-xs font-semibold tracking-wide uppercase data-open:border-accent">
        {current.group} · {current.label}
        <Chevron />
      </MenuButton>
      <MenuItems className="absolute top-full left-0 z-40 mt-1 grid w-64 grid-cols-2 gap-x-2 rounded-md border border-line bg-raised p-2 shadow-lg focus:outline-none">
        {(["Limit", "Market"] as const).map((group) => (
          <div key={group} className="flex flex-col">
            <span className="px-2 pb-1 text-[11px] text-muted">{group}</span>
            {ORDER_TYPES.filter((t) => t.group === group).map((t) => {
              const disabled = Boolean(t.perpOnly) && market.kind !== "perp";
              return (
                <MenuItem key={t.id} disabled={disabled}>
                  <button
                    type="button"
                    onClick={() => onChange(t.id)}
                    className={cx(
                      "rounded px-2 py-1.5 text-left text-xs data-disabled:opacity-40 data-focus:bg-line",
                      t.id === value && "bg-line text-accent",
                    )}
                  >
                    {t.label}
                  </button>
                </MenuItem>
              );
            })}
          </div>
        ))}
      </MenuItems>
    </Menu>
  );
}

export function Chevron() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Toggle({ on, onChange, children, disabled }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx(
        "rounded px-2 py-1 text-xs font-medium transition-colors duration-150 disabled:opacity-40",
        on ? "bg-accent/15 text-accent" : "text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function NumberBox({
  label,
  value,
  onChange,
  suffix,
  action,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: ReactNode;
  action?: ReactNode;
  placeholder?: string;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 rounded-md border border-line bg-surface px-2.5 py-1.5 focus-within:border-accent">
      <span className="flex items-center justify-between text-[10px] tracking-wide text-muted uppercase">
        {label}
        {action}
      </span>
      <span className="flex items-center">
        <input
          inputMode="decimal"
          value={value}
          placeholder={placeholder ?? "0.0"}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm tabular-nums outline-none placeholder:text-faint"
        />
        {suffix && <span className="ml-1 text-[11px] text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

const PRESETS = [25, 33, 50, 66, 75, 100];

// Dual base/USD size inputs, MAX, a percentage slider, and presets. Base size
// is the source of truth; USD converts through `refPx` (the price the order
// will actually use).
export function SizeControl({
  market,
  size,
  onSize,
  refPx,
  max,
}: {
  market: Market;
  size: string;
  onSize: (s: string) => void;
  refPx: number;
  max: number;
}) {
  const [usdDraft, setUsdDraft] = useState<string | null>(null);
  const [base, quote] = market.kind === "spot" ? market.name.split("/") : [market.name, "USDC"];
  const sizeNum = Number(size) || 0;
  const usd = usdDraft ?? (sizeNum > 0 && refPx > 0 ? (sizeNum * refPx).toFixed(2) : "");
  const pct = max > 0 ? Math.min(100, Math.round((sizeNum / max) * 100)) : 0;
  const setFraction = (f: number) => {
    setUsdDraft(null);
    onSize(sizeAtFraction(max, f, market.szDecimals));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <NumberBox
          label={base!}
          value={size}
          onChange={(v) => {
            setUsdDraft(null);
            onSize(v);
          }}
          action={
            <button type="button" disabled={!(max > 0)} onClick={() => setFraction(1)} className="rounded bg-raised px-1.5 text-[10px] text-fg hover:bg-line disabled:opacity-40">
              MAX
            </button>
          }
        />
        <NumberBox
          label={quote!}
          value={usd}
          onChange={(v) => {
            setUsdDraft(v);
            const n = Number(v);
            onSize(n > 0 ? usdToBase(n, refPx, market.szDecimals) : "");
          }}
          action={<span className="text-[10px] text-faint">{pct}%</span>}
        />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        disabled={!(max > 0)}
        aria-label="Size as a percent of max"
        onChange={(e) => setFraction(Number(e.target.value) / 100)}
        className="h-1.5 w-full accent-(--color-accent) disabled:opacity-40"
      />
      <div className="grid grid-cols-6 overflow-hidden rounded-md border border-line">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={!(max > 0)}
            onClick={() => setFraction(p / 100)}
            className={cx(
              "border-l border-line py-1 text-[11px] text-muted first:border-l-0 hover:bg-raised hover:text-fg disabled:opacity-40",
              pct === p && "bg-raised text-fg",
            )}
          >
            {p}%
          </button>
        ))}
      </div>
      <p className="text-[10px] text-faint">Max {max > 0 ? `${sizeAtFraction(max, 1, market.szDecimals) || 0} ${base} ≈ ${fmtUsd(max * refPx)}` : "unavailable"}</p>
    </div>
  );
}

export function SkewSlider({ label, value, onChange, lowLabel, highLabel }: { label: string; value: number; onChange: (v: number) => void; lowLabel: string; highLabel: string }) {
  const text = value === 0 ? "Even" : `${value < 0 ? lowLabel : highLabel} ${Math.round(Math.abs(value) * 100)}%`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted">{label}</span>
        <button type="button" onClick={() => onChange(0)} className="tabular-nums text-fg hover:text-accent" title="Reset to even">
          {text}
        </button>
      </div>
      <input
        type="range"
        min={-100}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="h-1.5 w-full accent-(--color-accent)"
      />
    </div>
  );
}
