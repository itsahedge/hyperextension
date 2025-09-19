import { NextResponse } from "next/server";
import { Hyperliquid } from "hyperliquid";
import { getUserPrivateKey } from "@/lib/turnkey/private-key";
import { supabase } from "@/app/core/supabase";
import { UserProfile } from "@/app/core/types";
import { getSecret } from "@/lib/turnkey/encryptionHelper";

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
  console.log(">>POST REQUEST");
  const { userId } = await req.json();
  // Authenticate user/session here!

  // given a user id, get the wallet address from supabase
  const { data: user, error: userError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (userError || !user) {
    return NextResponse.json(
      { error: "User not found" },
      { status: 404, headers: corsHeaders }
    );
  }

  const {
    sub_organization_id,
    p256_pub_key,
    p256_private_key,
    p256_pub_key_uncompressed,
    ethereum_address,
  } = user as UserProfile;

  const decryptedSubOrgId = getSecret(userId, sub_organization_id!);
  const decryptedPrivateKey = getSecret(userId, p256_private_key!);
  if (!decryptedSubOrgId || !decryptedPrivateKey) {
    return NextResponse.json(
      { error: "Failed to decrypt sub org id or private key" },
      { status: 500, headers: corsHeaders }
    );
  }

  let sdk;
  try {
    sdk = new Hyperliquid({
      enableWs: false,
      testnet: false,
      maxReconnectAttempts: 1,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500, headers: corsHeaders }
    );
  }

  try {
    // Fetch open perpetual positions
    const clearinghouseState = await sdk.info.perpetuals.getClearinghouseState(
      ethereum_address
    );
    // Extract open positions (positions with nonzero size)
    const openPositions = (clearinghouseState.assetPositions || [])
      .filter((pos: any) => {
        const szi = Number(pos.position.szi);
        return szi !== 0;
      })
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
    console.log(">>OPEN POSITIONS: ", openPositions);
    return NextResponse.json({ openPositions }, { headers: corsHeaders });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500, headers: corsHeaders }
    );
  }
}
