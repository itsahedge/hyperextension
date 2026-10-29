import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { useState } from "react";
import { CopyAddress } from "@/components/CopyAddress";
import { Card, Notice, Spinner, errorMessage } from "@/components/ui";
import { useUnitDepositAddress } from "@/hooks/queries";
import { useUnlocked } from "@/hooks/session";
import { CHAIN_NAMES, GUARDIANS, UNIT_ASSETS, type UnitAsset } from "@/lib/unit";

// BTC, ETH, SOL and other native assets -> this account's spot balance via
// Unit Protocol. No signing: Unit watches a deposit address tied to this account.
export function UnitDepositCard() {
  const { config } = useUnlocked();
  const [asset, setAsset] = useState<UnitAsset | null>(null);
  const deposit = useUnitDepositAddress(asset);
  const chains = CHAIN_NAMES[config.network];
  const label = (a: UnitAsset) => `${a.symbol} on ${chains[a.chain]}`;

  return (
    <Card title="Deposit BTC, ETH, SOL and more">
      <div className="flex flex-col gap-3">
        <Listbox value={asset} onChange={setAsset} by={(a, b) => a?.id === b?.id && a?.chain === b?.chain}>
          <div className="relative">
            <ListboxButton
              aria-label="Asset to deposit"
              className="flex h-9 w-full items-center justify-between rounded-md border border-line bg-surface px-2.5 text-xs data-open:border-accent"
            >
              <span className={asset ? "" : "text-faint"}>{asset ? label(asset) : "Choose an asset"}</span>
              <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </ListboxButton>
            <ListboxOptions className="absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-md border border-line bg-raised p-1 shadow-lg focus:outline-none">
              {UNIT_ASSETS.map((a) => (
                <ListboxOption
                  key={`${a.chain}/${a.id}`}
                  value={a}
                  className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-xs data-focus:bg-line data-selected:text-accent"
                >
                  <span>
                    {a.symbol} <span className="text-muted">{a.name}</span>
                  </span>
                  <span className="text-muted">{chains[a.chain]}</span>
                </ListboxOption>
              ))}
            </ListboxOptions>
          </div>
        </Listbox>

        {asset && deposit.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Spinner /> Getting and verifying the deposit address…
          </div>
        )}
        {asset && deposit.isError && <Notice tone="error">{errorMessage(deposit.error)}</Notice>}
        {asset && deposit.data && (
          <>
            <CopyAddress address={deposit.data.address} />
            <p className="text-[11px] text-faint">
              Signed by {deposit.data.verifiedBy.length} of {GUARDIANS[config.network].length} Unit guardians for this account.
            </p>
            <Notice tone="warn">
              Only send {asset.symbol} on {chains[asset.chain]}. Minimum {Number(asset.minimum).toLocaleString("en-US", { maximumFractionDigits: 8 })} {asset.symbol}; smaller
              deposits are not processed. Other tokens or networks can be lost.
            </Notice>
            <p className="text-xs text-muted">
              This address is permanent for this account. Deposits arrive in this account's spot balance after they confirm on{" "}
              {chains[asset.chain]}.
            </p>
          </>
        )}

        <p className="text-[11px] text-faint">
          Powered by Unit Protocol. Unit's terms prohibit use by residents of, or from, the United States, the United Kingdom and other
          listed jurisdictions.
        </p>
      </div>
    </Card>
  );
}
