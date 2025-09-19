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
  const sdk = new Hyperliquid({
    enableWs: false,
    testnet: false,
    maxReconnectAttempts: 1,
  });
  try {
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
    return NextResponse.json(
      { topMovers: sorted.slice(0, 10) },
      { headers: corsHeaders }
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500, headers: corsHeaders }
    );
  }
}
