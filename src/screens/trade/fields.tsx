import { cx } from "@/components/ui";
import type { PanelState } from "@/lib/entry";
import { fmtPrice } from "@/lib/format";
import type { Market } from "@/lib/markets";
import { MAX_SCALE_ORDERS, MIN_SCALE_ORDERS, type ScaleRung } from "@/lib/scale";
import { MAX_SWARM_LOTS, MIN_SWARM_LOTS } from "@/lib/swarm";
import { TWAP_MAX_MINUTES, TWAP_MIN_MINUTES } from "@/lib/twap";
import { NumberBox, SkewSlider, Toggle } from "./controls";

type Set = (patch: Partial<PanelState>) => void;
type FieldProps = { s: PanelState; set: Set; market: Market; book?: { bid: number; ask: number } };

const mid = (m: Market) => m.midPx ?? m.markPx;
const quick = (label: string, onClick: () => void) => (
  <button type="button" onClick={onClick} className="text-[10px] text-accent hover:underline">
    {label}
  </button>
);

export function LimitFields({ s, set, market, book }: FieldProps) {
  return (
    <NumberBox
      label="Price"
      value={s.price}
      onChange={(price) => set({ price })}
      placeholder={fmtPrice(mid(market))}
      action={
        <span className="flex gap-2">
          {book && book.bid > 0 && quick("Bid", () => set({ price: String(book.bid) }))}
          {quick("Mid", () => set({ price: String(mid(market)) }))}
          {book && book.ask > 0 && quick("Ask", () => set({ price: String(book.ask) }))}
        </span>
      }
    />
  );
}

export function StopFields({ s, set, market, withLimit }: FieldProps & { withLimit: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <NumberBox label="Trigger" value={s.trigger} onChange={(trigger) => set({ trigger })} placeholder={fmtPrice(mid(market))} />
        {withLimit && <NumberBox label="Limit price" value={s.stopLimit} onChange={(stopLimit) => set({ stopLimit })} />}
      </div>
      <p className="text-[10px] text-faint">
        Fires on the mark price. Above the current price, a long triggers as a stop and a short as a take (and the reverse below).
        {!withLimit && " Executes as market with up to 10% slippage."}
      </p>
    </div>
  );
}

function CountSlider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium">{label}</span>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.min(max, Math.max(min, Math.round(Number(e.target.value) || min))))}
          className="w-12 bg-transparent text-right tabular-nums outline-none"
          aria-label={label}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={`${label} slider`}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full accent-(--color-accent)"
      />
    </div>
  );
}

export function ScaleFields({ s, set, market, ladder }: FieldProps & { ladder: LadderView | null }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <NumberBox label="Price" value={s.scaleA} onChange={(scaleA) => set({ scaleA })} placeholder={fmtPrice(mid(market))} />
        <NumberBox label="Price" value={s.scaleB} onChange={(scaleB) => set({ scaleB })} placeholder={fmtPrice(mid(market))} />
      </div>
      <LadderControls s={s} set={set} ladder={ladder} />
    </div>
  );
}

const RANGE_PRESETS = ["0.5", "1", "2", "5"];

export function ScaleSideFields({ s, set, ladder }: FieldProps & { ladder: LadderView | null }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <NumberBox label="Quote offset" value={s.sideOffset} onChange={(sideOffset) => set({ sideOffset })} suffix="%" placeholder="0" />
        <NumberBox
          label="Range"
          value={s.sideRange}
          onChange={(sideRange) => set({ sideRange })}
          suffix="%"
          action={
            <span className="flex gap-1.5">
              {RANGE_PRESETS.map((r) => (
                <button key={r} type="button" onClick={() => set({ sideRange: r })} className={cx("text-[10px] hover:text-accent", s.sideRange === r ? "text-accent" : "text-faint")}>
                  {r}
                </button>
              ))}
            </span>
          }
        />
      </div>
      <p className="-mt-2 text-[10px] text-faint">Longs ladder down from the bid, shorts up from the ask.</p>
      <LadderControls s={s} set={set} ladder={ladder} caption="Long ladder shown; the short mirrors it above the ask." />
    </div>
  );
}

export interface LadderView {
  rungs: ScaleRung[];
  low: number;
  high: number;
  avgPx: number;
  warnings: string[];
}

function LadderControls({ s, set, ladder, caption }: { s: PanelState; set: Set; ladder: LadderView | null; caption?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <CountSlider label="Total orders" value={s.count} min={MIN_SCALE_ORDERS} max={MAX_SCALE_ORDERS} onChange={(count) => set({ count })} />
      <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-2.5">
        <SkewSlider label="Price skew" value={s.priceSkew} onChange={(priceSkew) => set({ priceSkew })} lowLabel="Low" highLabel="High" />
        <SkewSlider label="Size skew" value={s.sizeSkew} onChange={(sizeSkew) => set({ sizeSkew })} lowLabel="Low" highLabel="High" />
        <LadderPreview ladder={ladder} />
        {caption && ladder && <p className="text-[10px] text-faint">{caption}</p>}
      </div>
      {ladder?.warnings.map((w) => (
        <p key={w} className="text-[11px] text-warn">
          ⚠ {w}
        </p>
      ))}
    </div>
  );
}

// Rung prices as ticks along the range and rung sizes as bar heights.
function LadderPreview({ ladder }: { ladder: LadderView | null }) {
  if (!ladder) return <p className="py-3 text-center text-[11px] text-faint">Enter size and prices to preview</p>;
  const { rungs, low, high, avgPx } = ladder;
  const span = high - low || 1;
  const maxSz = Math.max(...rungs.map((r) => Number(r.sz)));
  const W = 320;
  const H = 36;
  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-full" aria-label={`${rungs.length} orders from ${low} to ${high}`} role="img">
        {rungs.map((r) => {
          const x = 2 + ((Number(r.px) - low) / span) * (W - 4);
          const h = 4 + (Number(r.sz) / maxSz) * (H - 6);
          return <rect key={r.px} x={x - 1} y={H - h} width={2} height={h} className="fill-accent/70" />;
        })}
        <line x1={2 + ((avgPx - low) / span) * (W - 4)} x2={2 + ((avgPx - low) / span) * (W - 4)} y1={0} y2={H} className="stroke-fg" strokeWidth={1} strokeDasharray="2 2" />
      </svg>
      <div className="flex justify-between text-[11px] tabular-nums">
        <span className="text-muted">{fmtPrice(low)}</span>
        <span>
          <span className="text-muted">Avg.</span> {fmtPrice(avgPx)}
        </span>
        <span className="text-muted">{fmtPrice(high)}</span>
      </div>
    </div>
  );
}

export function SwarmFields({ s, set }: FieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <CountSlider label="Total lots" value={s.lots} min={MIN_SWARM_LOTS} max={MAX_SWARM_LOTS} onChange={(lots) => set({ lots })} />
      <div className="flex items-center gap-1">
        <Toggle on={s.irregular} onChange={(irregular) => set({ irregular })}>
          Irregular lots
        </Toggle>
        <span className="text-[10px] text-faint">Lots sent together as one batch, each capped by slippage.</span>
      </div>
    </div>
  );
}

const DURATIONS = [5, 15, 30, 60, 240, 1440];

export function TwapFields({ s, set }: FieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <NumberBox
        label="Duration"
        value={String(s.minutes)}
        onChange={(v) => set({ minutes: Math.round(Number(v) || 0) })}
        suffix="min"
        action={
          <span className="flex gap-1.5">
            {DURATIONS.map((d) => (
              <button key={d} type="button" onClick={() => set({ minutes: d })} className={cx("text-[10px] hover:text-accent", s.minutes === d ? "text-accent" : "text-faint")}>
                {d >= 60 ? `${d / 60}h` : `${d}m`}
              </button>
            ))}
          </span>
        }
      />
      <div className="flex items-center gap-1">
        <Toggle on={s.randomize} onChange={(randomize) => set({ randomize })}>
          Randomize
        </Toggle>
        <span className="text-[10px] text-faint">
          Runs on Hyperliquid ({TWAP_MIN_MINUTES}m to {TWAP_MAX_MINUTES / 60}h, $100 min, 3% max slippage per suborder) and keeps going after the popup closes.
        </span>
      </div>
    </div>
  );
}

export function TpSlFields({ s, set, refPx, limitEntry }: { s: PanelState; set: Set; refPx: number; limitEntry: boolean }) {
  const pct = (v: string) => {
    const n = Number(v);
    return n > 0 && refPx > 0 ? `${(((n - refPx) / refPx) * 100).toFixed(2)}%` : undefined;
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <NumberBox label="Take profit" value={s.tp} onChange={(tp) => set({ tp })} action={<span className="text-[10px] text-faint">{pct(s.tp)}</span>} placeholder="Price" />
        <NumberBox label="Stop loss" value={s.sl} onChange={(sl) => set({ sl })} action={<span className="text-[10px] text-faint">{pct(s.sl)}</span>} placeholder="Price" />
      </div>
      <p className="text-[10px] text-faint">
        Market triggers on the mark price, up to 10% slippage, sized to the entry.
        {limitEntry && " Placed only if the entry fully fills; cancelling a partly filled entry cancels them."}
      </p>
    </div>
  );
}
