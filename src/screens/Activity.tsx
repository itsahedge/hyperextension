import { Disclosure, DisclosureButton, DisclosurePanel, Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import type { UserNonFundingLedgerUpdatesResponse } from "@nktkas/hyperliquid/api/info";
import { Fragment, useMemo, type ReactNode } from "react";
import { Badge, Empty, Loading, Notice, errorMessage } from "@/components/ui";
import { useFills, useFunding, useLedger, useMarketData } from "@/hooks/queries";
import { useUnlocked } from "@/hooks/session";
import { fillPrice, netClosedPnl, summarizeFills } from "@/lib/fills";
import type { Market } from "@/lib/markets";
import { groupBySwarm, type SwarmItem } from "@/lib/swarm";
import { fmtSignedUsd, fmtSize, fmtTime, fmtUsd, shortAddress, toneOf } from "@/lib/format";

const LIMIT = 100;

export function Activity() {
  return (
    <TabGroup className="flex flex-col gap-3">
      <TabList className="flex rounded-md bg-surface p-0.5">
        {["Trade History", "Funding", "Transfers"].map((label) => (
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

type Fill = NonNullable<ReturnType<typeof useFills>["data"]>[number];

// Spot names are BASE/QUOTE; a perp's name is its base. Before market data
// loads, a non-USDC fee token is the base (spot buys).
function baseToken(f: Fill, market: Market | undefined): string {
  return market ? market.name.split("/")[0]! : f.feeToken === "USDC" ? f.coin : f.feeToken;
}

const feeText = (fee: number | string, token: string | null, decimals = 8) =>
  token === null ? "fees in several tokens" : `fee ${fmtSize(fee, token === "USDC" ? 2 : decimals)} ${token}`;

function Fills() {
  const { config } = useUnlocked();
  const fills = useFills();
  const markets = useMarketData(config.network);
  // userFills returns newest first. PnL and price are shown as Hyperliquid's
  // Trade History shows them (lib/fills). Lots of a swarm order collapse into
  // one expandable row (lib/swarm cloids).
  const items = useMemo(() => groupBySwarm(fills.data ?? [], (f) => f.cloid), [fills.data]);
  if (fills.isPending) return <Loading />;
  if (fills.isError) return <Notice tone="error">{errorMessage(fills.error)}</Notice>;
  if (items.length === 0) return <Empty>No trades yet</Empty>;
  const marketOf = (coin: string) => markets.data?.byCoin.get(coin);

  return (
    <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface px-3">
      {items.slice(0, LIMIT).map((item) => {
        if (item.kind === "swarm") return <SwarmFills key={item.id} swarm={item} market={marketOf(item.rows[0]!.coin)} />;
        const f = item.row;
        const market = marketOf(f.coin);
        const pnl = netClosedPnl(f, baseToken(f, market));
        return (
          <Row
            key={`${f.tid}-${f.oid}`}
            left={
              <>
                <Badge tone={f.side === "B" ? "up" : "down"}>{f.dir}</Badge> {market?.label ?? f.coin}
              </>
            }
            sub={fmtTime(f.time)}
            right={`${fmtSize(f.sz)} @ ${fillPrice(f.px)}`}
            rightSub={
              <>
                <span className={toneOf(pnl)}>{fmtSignedUsd(pnl)}</span> · {feeText(f.fee, f.feeToken)}
              </>
            }
          />
        );
      })}
    </ul>
  );
}

function SwarmFills({ swarm, market }: { swarm: Extract<SwarmItem<Fill>, { kind: "swarm" }>; market: Market | undefined }) {
  const first = swarm.rows[0]!;
  const base = baseToken(first, market);
  const total = summarizeFills(swarm.rows, base);
  const filledLots = swarm.lots.length;
  return (
    <li>
      <Disclosure>
        <DisclosureButton className="group flex w-full items-center gap-2 py-2 text-left text-xs outline-none data-focus:outline-2 data-focus:outline-accent">
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">
              <Badge tone={first.side === "B" ? "up" : "down"}>{first.dir}</Badge> {market?.label ?? first.coin}{" "}
              <span className="text-accent">Swarm</span>
            </span>
            <span className="truncate text-faint">
              {fmtTime(first.time)} · {filledLots === swarm.lotCount ? `${filledLots} lots` : `${filledLots}/${swarm.lotCount} lots`}
            </span>
          </div>
          <div className="ml-auto flex shrink-0 flex-col items-end whitespace-nowrap tabular-nums">
            {`${fmtSize(total.size)} @ ${fillPrice(String(total.avgPx))}`}
            <span className="text-faint">
              <span className={toneOf(total.pnl)}>{fmtSignedUsd(total.pnl)}</span> · {feeText(total.fee, total.feeToken, 2)}
            </span>
          </div>
          <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0 text-muted transition-transform duration-150 group-data-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </DisclosureButton>
        <DisclosurePanel className="mb-2 grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 rounded-md bg-raised/50 px-2.5 py-1.5 text-[11px] tabular-nums whitespace-nowrap">
          {swarm.lots.map((l) => {
            const lot = summarizeFills(l.rows, base);
            return (
              <Fragment key={l.lot}>
                <span className="text-muted">Lot {l.lot}</span>
                <span className="text-right">
                  {fmtSize(lot.size)} @ {fillPrice(String(lot.avgPx))}
                </span>
                <span className="text-right text-faint">{feeText(lot.fee, lot.feeToken)}</span>
              </Fragment>
            );
          })}
        </DisclosurePanel>
      </Disclosure>
    </li>
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
