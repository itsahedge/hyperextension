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
  const { userId, amount, toPerp } = await req.json();
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

  // Securely fetch privateKey and walletAddress for this user
  const privateKey = await getUserPrivateKey(
    decryptedSubOrgId,
    p256_pub_key,
    decryptedPrivateKey,
    ethereum_address,
    p256_pub_key_uncompressed
  );

  let sdk;
  try {
    sdk = new Hyperliquid({
      enableWs: false,
      privateKey,
      testnet: false,
      walletAddress: ethereum_address,
      maxReconnectAttempts: 1,
    });
    console.log(">>SDK FROM NEXT: ", sdk);
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500, headers: corsHeaders }
    );
  }

  if (typeof amount !== "number" || typeof toPerp !== "boolean") {
    return NextResponse.json(
      { error: "amount (number) and toPerp (boolean) are required" },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    console.log(">> sdk.exchange:", sdk.exchange);
    const result = await sdk.exchange.transferBetweenSpotAndPerp(
      amount,
      toPerp
    );
    return NextResponse.json(
      { success: true, result },
      { headers: corsHeaders }
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500, headers: corsHeaders }
    );
  }
}
