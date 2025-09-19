import { NextResponse } from "next/server";
import { Hyperliquid } from "hyperliquid";
import { supabase } from "@/app/core/supabase";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

const topTraders = [
  "0xbc9efeb7403afe702593b128def2dece5da1bbaf",
  "0x56498e5f90c14060499b62b6f459b3e3fb9280c5",
  "0xbfc79c444c41a74516bf31237ebf586a231480b4",
];

// This actually shows combined pnl history (perps + spot)
export async function POST(req: Request) {
  // fetch all the user profiles from supabase and for all the user addresses, fetch the pnl history
  // const { data: users, error: userError } = await supabase
  //   .from("profiles")
  //   .select("*");

  // if (userError) {
  //   return NextResponse.json(
  //     { error: userError.message },
  //     { status: 500, headers: corsHeaders }
  //   );
  // }

  try {
    const sdk = new Hyperliquid({
      enableWs: false,
      testnet: false,
      maxReconnectAttempts: 1,
    });

    // Use topTraders array for testing
    const leaderboard = await Promise.all(
      topTraders.map(async (address) => {
        try {
          const periods = await sdk.info.portfolio(address);
          const allTime = periods.find(([period]) => period === "allTime");
          if (!allTime) return null;
          const pnlHistory = allTime[1].pnlHistory;
          if (!pnlHistory || pnlHistory.length === 0) return null;
          const [timestamp, lastPnl] = pnlHistory[pnlHistory.length - 1];
          return {
            userId: address,
            username: null,
            ethereum_address: address,
            lastPnl: Number(lastPnl),
            timestamp: Number(timestamp),
          };
        } catch (err) {
          // If error for this user, skip
          return null;
        }
      })
    );

    // Filter out users with no PnL data
    const filtered = leaderboard.filter((entry) => entry !== null);
    // Sort by lastPnl descending
    filtered.sort((a, b) => b.lastPnl - a.lastPnl);

    return NextResponse.json(
      { leaderboard: filtered },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || String(err) },
      { status: 500, headers: corsHeaders }
    );
  }
}
