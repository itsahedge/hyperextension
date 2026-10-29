import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import type { UserNonFundingLedgerUpdatesResponse } from "@nktkas/hyperliquid/api/info";
import type { ReactNode } from "react";
import { Badge, Empty, Loading, Notice, errorMessage } from "@/components/ui";
import { useFills, useFunding, useLedger, useMarketData } from "@/hooks/queries";
import { useUnlocked } from "@/hooks/session";
import { fmtPrice, fmtSignedUsd, fmtSize, fmtTime, fmtUsd, shortAddress, toneOf } from "@/lib/format";

const LIMIT = 100;

export function Activity() {
  return (
    <TabGroup className="flex flex-col gap-3">
      <TabList className="flex rounded-md bg-surface p-0.5">
        {["Fills", "Funding", "Transfers"].map((label) => (
          <Tab
            key={label}
            className="h-8 flex-1 rounded-[5px] text-xs font-medium text-muted outline-none data-focus:outline-2 data-focus:outline-accent data-selected:bg-raised data-selected:text-fg"
          >
            {label}
          </Tab>
        ))}
      </TabList>
      <TabPanels>
        <TabPanel>
          <Fills />
        </TabPanel>
        <TabPanel>
          <Funding />
        </TabPanel>
        <TabPanel>
          <Transfers />
        </TabPanel>
      </TabPanels>
    </TabGroup>
  );
}

function List<T>({
  query,
  empty,
  render,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; data?: T[] };
  empty: string;
  render: (item: T) => ReactNode;
}) {
  if (query.isPending) return <Loading />;
  if (query.isError) return <Notice tone="error">{errorMessage(query.error)}</Notice>;
  const items = query.data ?? [];
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface px-3">{items.slice(0, LIMIT).map(render)}</ul>;
}

function Row({ left, sub, right, rightSub }: { left: ReactNode; sub: ReactNode; right: ReactNode; rightSub?: ReactNode }) {
  return (
    <li className="flex items-center gap-2 py-2 text-xs">
      <div className="flex min-w-0 flex-col">
        <span className="font-medium">{left}</span>
        <span className="text-faint">{sub}</span>
      </div>
      <div className="ml-auto flex flex-col items-end tabular-nums">
        {right}
        {rightSub && <span className="text-faint">{rightSub}</span>}
      </div>
    </li>
  );
}

function Fills() {
  const { config } = useUnlocked();
  const fills = useFills();
  const markets = useMarketData(config.network);
  // userFills returns newest first.
  return (
    <List
      query={fills}
      empty="No fills yet"
      render={(f) => (
        <Row
          key={`${f.tid}-${f.oid}`}
          left={
            <>
              <Badge tone={f.side === "B" ? "up" : "down"}>{f.dir}</Badge> {markets.data?.byCoin.get(f.coin)?.name ?? f.coin}
            </>
          }
          sub={fmtTime(f.time)}
          right={`${fmtSize(f.sz)} @ ${fmtPrice(f.px)}`}
          rightSub={
            Number(f.closedPnl) !== 0 ? (
              <span className={toneOf(f.closedPnl)}>{fmtSignedUsd(f.closedPnl)}</span>
            ) : (
              `fee ${fmtSize(f.fee, 4)} ${f.feeToken}`
            )
          }
        />
      )}
    />
  );
}

function Funding() {
  const funding = useFunding();
  const rows = funding.data ? [...funding.data].sort((a, b) => b.time - a.time) : undefined;
  return (
    <List
      query={{ ...funding, data: rows }}
      empty="No funding payments in the last 7 days"
      render={(f) => (
        <Row
          key={`${f.hash}-${f.delta.coin}-${f.time}`}
          left={f.delta.coin}
          sub={fmtTime(f.time)}
          right={<span className={toneOf(f.delta.usdc)}>{fmtSignedUsd(f.delta.usdc)}</span>}
          rightSub={`rate ${(Number(f.delta.fundingRate) * 100).toFixed(4)}%`}
        />
      )}
    />
  );
}

type LedgerDelta = UserNonFundingLedgerUpdatesResponse[number]["delta"];

function describeDelta(d: LedgerDelta, self: string): { label: string; amount: string | null } {
  switch (d.type) {
    case "deposit":
      return { label: "Deposit", amount: fmtUsd(d.usdc) };
    case "withdraw":
      return { label: "Withdraw", amount: fmtUsd(d.usdc) };
    case "accountClassTransfer":
      return { label: d.toPerp ? "Spot → Perp" : "Perp → Spot", amount: fmtUsd(d.usdc) };
    case "internalTransfer":
      return {
        label: d.destination.toLowerCase() === self ? `From ${shortAddress(d.user)}` : `To ${shortAddress(d.destination)}`,
        amount: fmtUsd(d.usdc),
      };
    case "spotTransfer":
      return {
        label: `${d.token} ${d.destination.toLowerCase() === self ? `from ${shortAddress(d.user)}` : `to ${shortAddress(d.destination)}`}`,
        amount: fmtSize(d.amount),
      };
    case "send": {
      // sendAsset / agentSendAsset; dex "" is the default perp dex, "spot" is spot.
      const dex = (name: string) => (name === "" ? "Perp" : name === "spot" ? "Spot" : name);
      const label =
        d.user.toLowerCase() === self && d.destination.toLowerCase() === self
          ? `${dex(d.sourceDex)} → ${dex(d.destinationDex)}`
          : d.destination.toLowerCase() === self
            ? `${d.token} from ${shortAddress(d.user)}`
            : `${d.token} to ${shortAddress(d.destination)}`;
      return { label, amount: fmtUsd(d.usdcValue) };
    }
    case "liquidation":
      return { label: "Liquidation", amount: fmtUsd(d.liquidatedNtlPos) };
    default:
      return { label: d.type, amount: null };
  }
}

function Transfers() {
  const { config } = useUnlocked();
  const ledger = useLedger();
  const self = config.address.toLowerCase();
  const rows = ledger.data ? [...ledger.data].sort((a, b) => b.time - a.time) : undefined;
  return (
    <List
      query={{ ...ledger, data: rows }}
      empty="No transfers in the last 30 days"
      render={(u) => {
        const { label, amount } = describeDelta(u.delta, self);
        return <Row key={`${u.hash}-${u.time}`} left={label} sub={fmtTime(u.time)} right={amount ?? ""} />;
      }}
    />
  );
}
