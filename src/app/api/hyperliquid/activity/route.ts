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
    // Set startTime to 0 (beginning of time) and endTime to now
    const startTime = 0;
    const endTime = Date.now();

    const [ledgerUpdates, fills] = await Promise.all([
      sdk.info.perpetuals.getUserNonFundingLedgerUpdates(
        ethereum_address,
        startTime,
        endTime
      ),
      sdk.info.getUserFills(ethereum_address),
    ]);

    return NextResponse.json(
      {
        ledgerUpdates,
        fills,
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
