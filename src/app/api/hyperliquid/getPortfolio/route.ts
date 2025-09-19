import { NextResponse } from "next/server";
import { Hyperliquid } from "hyperliquid";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: Request) {
  const { ethereum_address } = await req.json();
  if (!ethereum_address) {
    return NextResponse.json(
      { error: "Missing ethereum_address" },
      { status: 400, headers: corsHeaders }
    );
  }

  let sdk;
  try {
    sdk = new Hyperliquid({
      enableWs: false,
      testnet: false,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500, headers: corsHeaders }
    );
  }

  try {
    // Fetch balances
    const [spotBalances, perpsBalances] = await Promise.all([
      sdk.info.spot.getSpotClearinghouseState(ethereum_address),
      sdk.info.perpetuals.getClearinghouseState(ethereum_address),
      // sdk.info.spot.getSpotMetaAndAssetCtxs(),
    ]);
    // const perpsBalances = await sdk.info.perpetuals.getClearinghouseState(
    //   ethereum_address
    // );
    console.log("perpsBalances", perpsBalances);
    console.log("spotBalances", spotBalances);

    // Get USDC spot
    // const usdcSpot = spotBalances.balances.find(
    //   (b: any) => b.coin === "USDC-SPOT"
    // );
    // const usdcValue = Number(usdcSpot?.total ?? 0);

    // Get PURR spot
    // const purrSpot = spotBalances.balances.find(
    //   (b: any) => b.coin === "PURR-SPOT"
    // );
    // const purrTotal = Number(purrSpot?.total ?? 0);
    // const purrEntryNtl = Number((purrSpot as any)?.entryNtl ?? 0);
    // const purrCtx = metaAndCtxs[1].find((ctx: any) => ctx.coin === "PURR-SPOT");
    // const purrSpotPrice = Number(purrCtx?.markPx ?? 0);
    // const purrValue = purrTotal * purrSpotPrice;
    // const purrPnl = purrValue - purrEntryNtl;

    // Perps value
    const perpsValue = Number(perpsBalances.marginSummary?.accountValue ?? 0);

    // Total portfolio value
    // const totalPortfolioValue = perpsValue + usdcValue + purrValue;

    return NextResponse.json(
      {
        perpsBalances,
        spotBalances,
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
