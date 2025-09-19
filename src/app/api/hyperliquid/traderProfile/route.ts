import { NextResponse } from "next/server";
import { Hyperliquid } from "hyperliquid";

// CORS headers
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

  const sdk = new Hyperliquid({
    enableWs: false,
    testnet: false,
    maxReconnectAttempts: 1,
  });
  try {
    const clearinghouseState = await sdk.info.perpetuals.getClearinghouseState(
      ethereum_address
    );

    // iterate over the cumFunding and log it
    clearinghouseState.assetPositions.forEach((p: any) => {
      console.log(">> cumFunding:", p.position.cumFunding);
    });

    // Also get pnlHistory from sdk.info.portfolio
    const periods = await sdk.info.portfolio(ethereum_address);
    const allTime = periods.find(
      ([period]: [string, any]) => period === "allTime"
    );
    let pnlHistory = null;
    if (allTime) {
      pnlHistory = allTime[1].pnlHistory;
      console.log(">> pnlHistory: ", pnlHistory);
    }

    return NextResponse.json(
      { clearinghouseState, pnlHistory },
      { headers: corsHeaders }
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500, headers: corsHeaders }
    );
  }
}
