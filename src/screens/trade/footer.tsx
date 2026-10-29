import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Modal, Notice, Segmented, TextField, errorMessage } from "@/components/ui";
import { useExchange } from "@/hooks/queries";
import type { Market } from "@/lib/markets";
import { prefsItem } from "@/lib/storage";

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
    <div className="flex items-center justify-between border-t border-line pt-2 text-[11px] font-medium tracking-wide text-muted uppercase">
      {isPerp ? (
        <button type="button" onClick={() => setEditLev(true)} className="uppercase hover:text-fg" disabled={!leverage}>
          {leverage ? `${leverage.type} · ${leverage.value}x` : "…"}
        </button>
      ) : (
        <span>Spot</span>
      )}
      <button type="button" onClick={() => setEditSlip(true)} className="uppercase hover:text-fg">
        Slip {+(slippage * 100).toFixed(2)}%
      </button>
      {isPerp && leverage && <LeverageDialog open={editLev} onClose={() => setEditLev(false)} market={market} current={leverage} />}
      <SlippageDialog open={editSlip} onClose={() => setEditSlip(false)} current={slippage} />
    </div>
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
  const [value, setValue] = useState(String(current.value));
  const [mode, setMode] = useState(current.type);
  const update = useExchange((client, v: number) => client.updateLeverage({ asset: market.assetId, isCross: mode === "cross", leverage: v }));
  const max = market.maxLeverage ?? 1;
  const n = Number(value);
  const invalid = !Number.isInteger(n) || n < 1 || n > max;

  return (
    <Modal open={open} onClose={onClose} title={`${market.name} leverage`}>
      <div className="flex flex-col gap-3">
        <Segmented
          label="Margin mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "cross", label: "Cross" },
            { value: "isolated", label: "Isolated" },
          ]}
        />
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
    await prefsItem.setValue({ slippage: n / 100 });
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
