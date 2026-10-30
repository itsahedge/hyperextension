import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import type { Market } from "@/lib/markets";
import { cx } from "./ui";

// "All markets" plus every market that has rows, with a count each.
export function MarketFilter({
  value,
  onChange,
  coins,
  counts,
  byCoin,
}: {
  value: string | null;
  onChange: (coin: string | null) => void;
  coins: string[];
  counts: Map<string, number>;
  byCoin: Map<string, Market>;
}) {
  const name = (coin: string) => byCoin.get(coin)?.label ?? coin;
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const options: { coin: string | null; label: string; count: number }[] = [
    { coin: null, label: "All markets", count: total },
    ...coins.map((c) => ({ coin: c, label: name(c), count: counts.get(c) ?? 0 })),
  ];
  return (
    <Listbox value={value} onChange={onChange}>
      <div className="relative">
        <ListboxButton aria-label="Market filter" className="flex h-8 w-full items-center justify-between rounded-md border border-line bg-surface px-2.5 text-xs data-open:border-accent">
          <span>{value === null ? "All markets" : name(value)}</span>
          <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </ListboxButton>
        <ListboxOptions className="absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-md border border-line bg-raised p-1 shadow-lg focus:outline-none">
          {options.map((o) => (
            <ListboxOption
              key={o.coin ?? "all"}
              value={o.coin}
              className={cx("flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-xs data-focus:bg-line data-selected:text-accent")}
            >
              <span>{o.label}</span>
              <span className="text-muted tabular-nums">{o.count}</span>
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
