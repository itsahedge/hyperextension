import { NextResponse } from "next/server";
import { Hyperliquid } from "hyperliquid";
import { supabase } from "@/app/core/supabase";
import { UserProfile } from "@/app/core/types";
import { getSecret } from "@/lib/turnkey/encryptionHelper";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: Request) {
  const { userId, ethereum_address } = await req.json();
  if (!userId || !ethereum_address) {
    return NextResponse.json(
      { error: "Missing userId or ethereum_address" },
      { status: 400, headers: corsHeaders }
    );
  }

  const sdk = new Hyperliquid({
    enableWs: false,
    testnet: false,
    maxReconnectAttempts: 1,
  });

  try {
    // --- Portfolio Logic ---
    const [spotBalances, perpsBalances, metaAndCtxs] = await Promise.all([
      sdk.info.spot.getSpotClearinghouseState(ethereum_address),
      sdk.info.perpetuals.getClearinghouseState(ethereum_address),
      sdk.info.spot.getSpotMetaAndAssetCtxs(),
    ]);

    // USDC spot
    const usdcSpot = spotBalances.balances.find(
      (b: any) => b.coin === "USDC-SPOT"
    );
    const usdcValue = Number(usdcSpot?.total ?? 0);

    // PURR spot
    const purrSpot = spotBalances.balances.find(
      (b: any) => b.coin === "PURR-SPOT"
    );
    const purrTotal = Number(purrSpot?.total ?? 0);
    const purrEntryNtl = Number((purrSpot as any)?.entryNtl ?? 0);
    const purrCtx = metaAndCtxs[1].find((ctx: any) => ctx.coin === "PURR-SPOT");
    const purrSpotPrice = Number(purrCtx?.markPx ?? 0);
    const purrValue = purrTotal * purrSpotPrice;
    const purrPnl = purrValue - purrEntryNtl;

    // Perps value
    const perpsValue = Number(perpsBalances.marginSummary?.accountValue ?? 0);

    // Total portfolio value
    const totalPortfolioValue = perpsValue + usdcValue + purrValue;

    // --- Positions Logic ---
    const clearinghouseState = perpsBalances; // already fetched above
    const openPositions = (clearinghouseState.assetPositions || [])
      .filter((pos: any) => Number(pos.position.szi) !== 0)
      .map((pos: any) => ({
        coin: pos.position.coin,
        szi: pos.position.szi,
        entryPx: pos.position.entryPx,
        unrealizedPnl: pos.position.unrealizedPnl,
        leverage: pos.position.leverage,
        liquidationPx: pos.position.liquidationPx,
        marginUsed: pos.position.marginUsed,
        positionValue: pos.position.positionValue,
        returnOnEquity: pos.position.returnOnEquity,
      }));

    // --- Top Movers Logic ---
    const [meta, assetCtxs] = await sdk.info.perpetuals.getMetaAndAssetCtxs();
    const changes = assetCtxs.map((ctx: any, i: number) => {
      const markPx = parseFloat(ctx.markPx);
      const prevDayPx = parseFloat(ctx.prevDayPx);
      const change =
        prevDayPx !== 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0;
      return {
        name: meta.universe[i].name,
        markPx,
        prevDayPx,
        change,
      };
    });
    const positiveMovers = changes.filter((m) => m.change > 0);
    const sorted = positiveMovers.sort((a, b) => b.change - a.change);
    const topMovers = sorted.slice(0, 10);

    // --- Return all data ---
    return NextResponse.json(
      {
        portfolio: {
          totalPortfolioValue,
          perpsValue,
          usdcValue,
          purr: {
            total: purrTotal,
            price: purrSpotPrice,
            value: purrValue,
            entryNtl: purrEntryNtl,
            pnl: purrPnl,
          },
        },
        openPositions,
        topMovers,
      },
      { headers: corsHeaders }
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500, headers: corsHeaders }
    );
  }
}
