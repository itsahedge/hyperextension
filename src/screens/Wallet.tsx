import { useState, type FormEvent } from "react";
import { Button, Card, ConfirmDialog, Empty, Loading, Notice, Segmented, Stat, TextField, errorMessage } from "@/components/ui";
import { useExchange, useMarketData, usePerpState, useSpotState } from "@/hooks/queries";
import { useUnlocked } from "@/hooks/session";
import { parseAddress } from "@/lib/account";
import { fmtSize, fmtUsd } from "@/lib/format";
import { freeBalance, spotTokenPrice } from "@/lib/markets";

export function Wallet() {
  const { config } = useUnlocked();
  const perp = usePerpState();
  const spot = useSpotState();
  const markets = useMarketData(config.network);

  if (perp.isPending || spot.isPending) return <Loading />;
  if (perp.isError) return <Notice tone="error">{errorMessage(perp.error)}</Notice>;
  if (spot.isError) return <Notice tone="error">{errorMessage(spot.error)}</Notice>;

  const balances = spot.data.balances.filter((b) => Number(b.total) !== 0);
  const usdc = spot.data.balances.find((b) => b.coin === "USDC");
  const spotUsdcFree = usdc ? freeBalance(usdc) : 0;

  return (
    <div className="flex flex-col gap-3">
      <Card title="Perp account">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Equity" value={fmtUsd(perp.data.marginSummary.accountValue)} />
          <Stat label="Withdrawable" value={fmtUsd(perp.data.withdrawable)} />
        </div>
      </Card>

      <Card title="Spot balances">
        {balances.length === 0 ? (
          <Empty>No spot balances</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line text-xs">
            {balances.map((b) => {
              const price = markets.data ? spotTokenPrice(b.coin, markets.data.markets) : null;
              return (
                <li key={b.coin} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
                  <span className="font-medium">{b.coin}</span>
                  <span className="ml-auto tabular-nums">{fmtSize(b.total)}</span>
                  <span className="min-w-20 text-right text-muted tabular-nums">
                    {price === null ? "-" : fmtUsd(Number(b.total) * price)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <TransferCard spotFree={spotUsdcFree} perpFree={Number(perp.data.withdrawable)} usdcToken={markets.data?.usdcToken} />
      <WithdrawCard withdrawable={Number(perp.data.withdrawable)} />

      <Card title="Receive">
        <p className="mb-2 text-xs text-muted">Deposit with the Hyperliquid app or bridge. This extension does not bridge.</p>
        <CopyAddress address={config.address} />
      </Card>
    </div>
  );
}

function validAmount(amount: string, max: number): string | null {
  if (!amount) return null;
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "Enter an amount above zero";
  if (n > max) return `Only ${fmtUsd(max)} available`;
  return null;
}

function TransferCard({ spotFree, perpFree, usdcToken }: { spotFree: number; perpFree: number; usdcToken: string | undefined }) {
  const { config } = useUnlocked();
  const [toPerp, setToPerp] = useState(true);
  const [amount, setAmount] = useState("");
  const max = toPerp ? spotFree : perpFree;
  const error = validAmount(amount, max);

  // usdClassTransfer is user-signed (master key). In API wallet mode the agent
  // moves USDC between its own account's spot and perp balances with
  // agentSendAsset, an L1 action whose destination must be the same account.
  const transfer = useExchange((client, a: { amount: string; toPerp: boolean }) => {
    if (config.mode === "master") return client.usdClassTransfer(a);
    if (!usdcToken) throw new Error("Spot metadata not loaded");
    return client.agentSendAsset({
      destination: config.address,
      sourceDex: a.toPerp ? "spot" : "",
      destinationDex: a.toPerp ? "" : "spot",
      token: usdcToken,
      amount: a.amount,
    });
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (error || !amount) return;
    transfer.mutate({ amount: amount.trim(), toPerp }, { onSuccess: () => setAmount("") });
  };

  return (
    <Card title="Transfer USDC">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Segmented
          label="Direction"
          value={toPerp ? "toPerp" : "toSpot"}
          onChange={(v) => setToPerp(v === "toPerp")}
          options={[
            { value: "toPerp", label: "Spot → Perp" },
            { value: "toSpot", label: "Perp → Spot" },
          ]}
        />
        <TextField
          label="Amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          suffix={
            <button type="button" className="text-accent hover:underline" onClick={() => setAmount(String(Math.floor(max * 100) / 100))}>
              Max {fmtUsd(max)}
            </button>
          }
          error={error}
        />
        {transfer.isError && <Notice tone="error">{errorMessage(transfer.error)}</Notice>}
        {transfer.isSuccess && <Notice tone="success">Transfer submitted</Notice>}
        <Button type="submit" variant="primary" busy={transfer.isPending} disabled={!amount || Boolean(error)}>
          Transfer
        </Button>
      </form>
    </Card>
  );
}

function WithdrawCard({ withdrawable }: { withdrawable: number }) {
  const { config, canUserSign } = useUnlocked();
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState<string>(config.address);
  const [confirming, setConfirming] = useState(false);
  const withdraw = useExchange(
    (client, a: { amount: string; destination: `0x${string}` }) => client.withdraw3(a),
    { userSigned: true },
  );

  const amountError = validAmount(amount, withdrawable);
  let destError: string | null = null;
  try {
    parseAddress(destination);
  } catch {
    destError = "Invalid address";
  }
  const external = destination.trim().toLowerCase() !== config.address.toLowerCase();

  if (!canUserSign) {
    return (
      <Card title="Withdraw to Arbitrum">
        <Notice tone="info">Withdrawals need the master key. API wallets cannot withdraw.</Notice>
      </Card>
    );
  }

  return (
    <Card title="Withdraw to Arbitrum">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!amountError && !destError && amount) setConfirming(true);
        }}
        className="flex flex-col gap-3"
      >
        <TextField
          label="Amount (USDC)"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={amountError}
          hint={`Withdrawable ${fmtUsd(withdrawable)}`}
        />
        <TextField
          label="Destination"
          spellCheck={false}
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          error={destError}
          hint={external ? "Not this account's address. Double-check it." : "This account's address on Arbitrum"}
        />
        {withdraw.isError && <Notice tone="error">{errorMessage(withdraw.error)}</Notice>}
        {withdraw.isSuccess && <Notice tone="success">Withdrawal requested. It usually finalizes in about 5 minutes.</Notice>}
        <Button type="submit" variant="primary" disabled={!amount || Boolean(amountError) || Boolean(destError)}>
          Review withdrawal
        </Button>
      </form>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Confirm withdrawal"
        confirmLabel="Withdraw"
        onConfirm={() =>
          withdraw.mutateAsync({ amount: amount.trim(), destination: parseAddress(destination) }).then(() => setAmount(""))
        }
      >
        <p>
          Withdraw <strong className="text-fg">{fmtUsd(amount || 0)}</strong> USDC to{" "}
          <span className="font-mono break-all text-fg">{destination.trim()}</span> on Arbitrum.
        </p>
        <p className="mt-2">Hyperliquid charges a $1 withdrawal fee. Signed with the master key.</p>
        {external && <p className="mt-2 text-warn">This is not your account address.</p>}
      </ConfirmDialog>
    </Card>
  );
}

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md bg-raised p-2">
      <span className="min-w-0 flex-1 font-mono text-[11px] break-all">{address}</span>
      <Button
        size="sm"
        onClick={() =>
          navigator.clipboard.writeText(address).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
