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

// This actually shows combined pnl history (perps + spot)
export async function POST(req: Request) {
  const { ethereum_address } = await req.json();

  if (!ethereum_address) {
    return NextResponse.json(
      { error: "Missing ethereum_address" },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    const sdk = new Hyperliquid({
      enableWs: false,
      testnet: false,
      maxReconnectAttempts: 1,
    });
    const periods = await sdk.info.portfolio(ethereum_address);
    const allTime = periods.find(([period]) => period === "allTime");
    if (!allTime) {
      return NextResponse.json(
        { error: "No allTime PnL history found for this user." },
        { status: 404, headers: corsHeaders }
      );
    }
    const pnlHistory = allTime[1].pnlHistory;
    console.log(">> pnlHistory: ", pnlHistory);
    return NextResponse.json({ pnlHistory }, { headers: corsHeaders });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || String(err) },
      { status: 500, headers: corsHeaders }
    );
  }
}
