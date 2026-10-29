import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatEther, formatUnits, type Hex } from "viem";
import { AuthorizeDialog } from "@/components/AuthorizeDialog";
import { Button, Card, Notice, Segmented, TextField, errorMessage } from "@/components/ui";
import { useArbitrumBalances, useCctpFee } from "@/hooks/queries";
import { useUnlocked } from "@/hooks/session";
import { CCTP_CONFIG, fetchFeeQuote, parseUsdc, planDeposit, USDC_DECIMALS, type DepositDex } from "@/lib/cctp";
import { submitDeposit } from "@/lib/cctpClient";
import { verify } from "@/lib/session";

const usdc = (units: bigint) => formatUnits(units, USDC_DECIMALS);

// USDC on Arbitrum -> this account on Hyperliquid, via Circle CCTP.
export function DepositCard() {
  const { config, secrets, canUserSign } = useUnlocked();
  const cfg = CCTP_CONFIG[config.network];
  const balances = useArbitrumBalances();
  const fee = useCctpFee(config.network);
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [dex, setDex] = useState<DepositDex>("perp");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ hash: Hex } | null>(null);

  let plan = null;
  let planError: string | null = null;
  if (amount && fee.data) {
    try {
      plan = planDeposit(cfg, { amount: parseUsdc(amount), recipient: config.address, dex, quote: fee.data, balance: balances.data?.usdc });
    } catch (err) {
      planError = errorMessage(err);
    }
  }
  const noGas = balances.data !== undefined && balances.data.eth === 0n;
  const chainName = config.network === "testnet" ? "Arbitrum Sepolia" : "Arbitrum";

  const deposit = async (auth: Parameters<typeof verify>[0]) => {
    if (!secrets.masterKey) throw new Error("Depositing needs the master key");
    await verify(auth);
    // Re-quote and re-plan at send time so the fee and balance are current.
    const quote = await fetchFeeQuote(cfg);
    const fresh = planDeposit(cfg, { amount: parseUsdc(amount), recipient: config.address, dex, quote, balance: balances.data?.usdc });
    const { hash, status } = await submitDeposit(config.network, secrets.masterKey, fresh);
    if (status !== "success") throw new Error(`Arbitrum transaction reverted (${hash})`);
    setResult({ hash });
    setAmount("");
    await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "markets" });
  };

  return (
    <Card title={`Deposit USDC from ${chainName}`}>
      <div className="flex flex-col gap-3">
        <div className="flex justify-between text-xs">
          <span className="text-muted">On {chainName} (this account)</span>
          <span className="tabular-nums">
            {balances.isPending ? "…" : balances.isError ? "unavailable" : `${usdc(balances.data.usdc)} USDC · ${Number(formatEther(balances.data.eth)).toFixed(5)} ETH`}
          </span>
        </div>
        {balances.isError && <Notice tone="error">{errorMessage(balances.error)}</Notice>}
        {!canUserSign ? (
          <Notice tone="info">Depositing signs an {chainName} transaction with the master key. API wallets cannot deposit.</Notice>
        ) : (
          <>
            <TextField
              label="Amount (USDC)"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              error={planError}
              suffix={
                balances.data && balances.data.usdc > 0n ? (
                  <button type="button" className="text-accent hover:underline" onClick={() => setAmount(usdc(balances.data.usdc))}>
                    Max
                  </button>
                ) : undefined
              }
              hint={
                fee.isError
                  ? "Could not load Circle's fee"
                  : plan
                    ? `Fee up to ${usdc(plan.maxFee)} USDC · arrives as at least ${usdc(plan.minReceived)} USDC`
                    : fee.data
                      ? `Circle fee ${usdc(fee.data.forwardFee)} USDC${fee.data.minimumFeeBps ? ` + ${fee.data.minimumFeeBps} bps` : ""}`
                      : undefined
              }
            />
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">Credit to</span>
              <Segmented
                label="Deposit destination"
                value={dex}
                onChange={setDex}
                options={[
                  { value: "perp", label: "Perps" },
                  { value: "spot", label: "Spot" },
                ]}
              />
            </div>
            {noGas && <Notice tone="warn">This account has no ETH on {chainName} to pay gas. Send a little ETH there first.</Notice>}
            {result && (
              <Notice tone="success">
                Deposit sent.{" "}
                <a className="underline" href={`${cfg.explorer}/tx/${result.hash}`} target="_blank" rel="noreferrer">
                  View on explorer
                </a>
                . USDC usually arrives within a few minutes.
              </Notice>
            )}
            <Button variant="primary" disabled={!plan || noGas} onClick={() => setConfirming(true)}>
              Review deposit
            </Button>
          </>
        )}
        <p className="text-[11px] text-faint">
          Uses Circle CCTP: USDC is burned on {chainName} and minted to this account on Hyperliquid. Gas is paid in ETH on {chainName}.
        </p>
      </div>
      <AuthorizeDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Confirm deposit"
        confirmLabel="Deposit"
        onAuthorized={deposit}
        description={
          plan && (
            <>
              <p>
                Deposit <strong className="text-fg">{usdc(plan.amount)} USDC</strong> from {chainName} to this account's Hyperliquid{" "}
                {dex === "perp" ? "perps" : "spot"} balance.
              </p>
              <p className="mt-2">
                Circle fee up to {usdc(plan.maxFee)} USDC; at least {usdc(plan.minReceived)} USDC arrives. Signed with the master key; you pay {chainName} gas.
              </p>
              <p className="mt-2">Keep the popup open until the {chainName} transaction confirms.</p>
            </>
          )
        }
      />
    </Card>
  );
}
