import { useState, type FormEvent } from "react";
import { AuthorizeDialog } from "@/components/AuthorizeDialog";
import { SpotBalancesCard } from "@/components/SpotBalances";
import { Button, Card, Loading, Notice, Segmented, Stat, TextField, errorMessage } from "@/components/ui";
import { useExchange, useMarketData, usePerpState, useSpotState } from "@/hooks/queries";
import { useUnlocked } from "@/hooks/session";
import { fmtUsd } from "@/lib/format";
import { freeBalance } from "@/lib/markets";
import { verify } from "@/lib/session";
import { DepositCard } from "./wallet/DepositCard";
import { assertWithdrawDestination, withdrawDestinations } from "@/lib/withdraw";

export function Wallet() {
  const { config } = useUnlocked();
  const perp = usePerpState();
  const spot = useSpotState();
  const markets = useMarketData(config.network);

  if (perp.isPending || spot.isPending) return <Loading />;
  if (perp.isError) return <Notice tone="error">{errorMessage(perp.error)}</Notice>;
  if (spot.isError) return <Notice tone="error">{errorMessage(spot.error)}</Notice>;

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

      <SpotBalancesCard balances={spot.data.balances} markets={markets.data?.markets} />

      <DepositCard />
      <TransferCard spotFree={spotUsdcFree} perpFree={Number(perp.data.withdrawable)} usdcToken={markets.data?.usdcToken} />
      <WithdrawCard withdrawable={Number(perp.data.withdrawable)} />

      <Card title="Hyperliquid address">
        <p className="mb-2 text-xs text-muted">
          For USDC and tokens sent from another Hyperliquid account. Sending USDC to this address on Arbitrum does not
          deposit it; use Deposit above.
        </p>
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
  const { config, secrets, canUserSign } = useUnlocked();
  const allowlist = secrets.withdrawAllowlist ?? [];
  const destinations = withdrawDestinations(config.address, allowlist);
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState<string>(config.address);
  const [confirming, setConfirming] = useState(false);
  const withdraw = useExchange(
    (client, a: { amount: string; destination: `0x${string}` }) => client.withdraw3(a),
    { userSigned: true },
  );

  const amountError = validAmount(amount, withdrawable);
  // The selected entry can disappear if it is removed from the allowlist.
  const selected = destinations.find((d) => d.address === destination) ?? destinations[0]!;
  const external = selected.address !== config.address;

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
          if (!amountError && amount) setConfirming(true);
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
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Destination</span>
          <select
            value={selected.address}
            onChange={(e) => setDestination(e.target.value)}
            className="h-9 rounded-md border border-line bg-surface px-2 text-xs outline-none focus:border-accent"
          >
            {destinations.map((d) => (
              <option key={d.address} value={d.address}>
                {d.label} · {d.address.slice(0, 6)}…{d.address.slice(-4)}
              </option>
            ))}
          </select>
          <span className="text-xs text-faint">Only allowlisted addresses. Add more in Settings → Withdrawal addresses.</span>
        </label>
        {withdraw.isError && <Notice tone="error">{errorMessage(withdraw.error)}</Notice>}
        {withdraw.isSuccess && <Notice tone="success">Withdrawal requested. It usually finalizes in about 5 minutes.</Notice>}
        <Button type="submit" variant="primary" disabled={!amount || Boolean(amountError)}>
          Review withdrawal
        </Button>
      </form>
      <AuthorizeDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Confirm withdrawal"
        confirmLabel="Withdraw"
        onAuthorized={async (auth) => {
          const to = assertWithdrawDestination(selected.address, config.address, allowlist);
          await verify(auth);
          await withdraw.mutateAsync({ amount: amount.trim(), destination: to });
          setAmount("");
        }}
        description={<WithdrawSummary amount={amount} destination={`${selected.label} (${selected.address})`} external={external} />}
      />
    </Card>
  );
}

function WithdrawSummary({ amount, destination, external }: { amount: string; destination: string; external: boolean }) {
  return (
    <>
      <p>
        Withdraw <strong className="text-fg">{fmtUsd(amount || 0)}</strong> USDC to{" "}
        <span className="font-mono break-all text-fg">{destination.trim()}</span> on Arbitrum.
      </p>
      <p className="mt-2">Hyperliquid charges a $1 withdrawal fee. Signed with the master key.</p>
      {external && <p className="mt-2 text-warn">This is an allowlisted address, not this account.</p>}
    </>
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
