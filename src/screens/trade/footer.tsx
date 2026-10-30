import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Button, Modal, Notice, Segmented, TextField, errorMessage } from "@/components/ui";
import { useExchange } from "@/hooks/queries";
import type { Market } from "@/lib/markets";
import { updatePrefs } from "@/lib/prefs";

export function PanelFooter({
  market,
  leverage,
  slippage,
}: {
  market: Market;
  leverage: { type: "cross" | "isolated"; value: number } | undefined;
  slippage: number;
}) {
  const [editLev, setEditLev] = useState(false);
  const [editSlip, setEditSlip] = useState(false);
  const isPerp = market.kind === "perp";
  return (
    <div className="flex items-center justify-between border-t border-line pt-2 text-[11px] text-muted">
      {isPerp ? (
        <SettingButton onClick={() => setEditLev(true)} disabled={!leverage}>
          {leverage ? `${leverage.type === "cross" ? "Cross" : "Isolated"} ${leverage.value}x` : "…"}
        </SettingButton>
      ) : (
        <span>Spot</span>
      )}
      <SettingButton onClick={() => setEditSlip(true)}>
        Slippage {+(slippage * 100).toFixed(2)}%
      </SettingButton>
      {isPerp && leverage && <LeverageDialog open={editLev} onClose={() => setEditLev(false)} market={market} current={leverage} />}
      <SlippageDialog open={editSlip} onClose={() => setEditSlip(false)} current={slippage} />
    </div>
  );
}

// A current setting that opens its editor.
function SettingButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-haspopup="dialog"
      className="inline-flex h-6 items-center gap-1 rounded-md border border-line px-2 font-medium text-fg transition-[border-color,background-color] duration-150 hover:border-faint hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
    >
      {children}
      <svg aria-hidden viewBox="0 0 16 16" className="size-3 text-muted" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function LeverageDialog({
  open,
  onClose,
  market,
  current,
}: {
  open: boolean;
  onClose: () => void;
  market: Market;
  current: { type: "cross" | "isolated"; value: number };
}) {
  // noCross / strictIsolated markets (common on HIP-3) reject cross margin.
  const isolatedOnly = market.marginMode === "noCross" || market.marginMode === "strictIsolated";
  const [value, setValue] = useState(String(current.value));
  const [mode, setMode] = useState(isolatedOnly ? "isolated" : current.type);
  const update = useExchange((client, v: number) => client.updateLeverage({ asset: market.assetId, isCross: mode === "cross", leverage: v }));
  const max = market.maxLeverage ?? 1;
  const n = Number(value);
  const invalid = !Number.isInteger(n) || n < 1 || n > max;

  return (
    <Modal open={open} onClose={onClose} title={`${market.label} leverage`}>
      <div className="flex flex-col gap-3">
        <Segmented
          label="Margin mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "cross", label: "Cross", disabled: isolatedOnly },
            { value: "isolated", label: "Isolated" },
          ]}
        />
        {isolatedOnly && <p className="text-[11px] text-faint">This market only allows isolated margin.</p>}
        <TextField label="Leverage" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} suffix={`x (max ${max})`} error={invalid ? `Whole number from 1 to ${max}` : null} />
        <input type="range" min={1} max={max} value={invalid ? 1 : n} onChange={(e) => setValue(e.target.value)} aria-label="Leverage slider" className="h-1.5 w-full accent-(--color-accent)" />
        {update.isError && <Notice tone="error">{errorMessage(update.error)}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={invalid} busy={update.isPending} onClick={() => update.mutate(n, { onSuccess: onClose })}>
            Confirm
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const SLIP_PRESETS = [0.5, 1, 2, 5];

function SlippageDialog({ open, onClose, current }: { open: boolean; onClose: () => void; current: number }) {
  const queryClient = useQueryClient();
  const [pct, setPct] = useState(String(+(current * 100).toFixed(2)));
  const n = Number(pct);
  const invalid = !(n > 0 && n < 50);
  const save = async () => {
    await updatePrefs({ slippage: n / 100 });
    await queryClient.invalidateQueries({ queryKey: ["prefs"] });
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Max slippage">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">Caps market, swarm, and close orders this far from the mid price. Unfilled parts are cancelled.</p>
        <TextField label="Slippage" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} suffix="%" error={invalid ? "Between 0% and 50%" : null} />
        <div className="flex gap-2">
          {SLIP_PRESETS.map((p) => (
            <Button key={p} size="sm" variant={n === p ? "primary" : "secondary"} onClick={() => setPct(String(p))}>
              {p}%
            </Button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={invalid} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
