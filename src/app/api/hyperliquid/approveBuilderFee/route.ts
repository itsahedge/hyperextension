import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/app/core/supabase";
import { getSecret } from "@/lib/turnkey/encryptionHelper";
import { getUserPrivateKey } from "@/lib/turnkey/private-key";
import { Hyperliquid } from "hyperliquid";
import { UserProfile } from "@/app/core/types";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

const initializeSdkWithUser = async (userId: string) => {
  const { data: user, error: userError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (userError || !user) {
    throw new Error("User not found");
  }

  const {
    sub_organization_id,
    ethereum_address,
    p256_private_key,
    p256_pub_key,
    p256_pub_key_uncompressed,
  } = user as UserProfile;
  if (!p256_private_key || !sub_organization_id) {
    throw new Error("Encrypted private key or sub org id not found");
  }

  const decryptedP256PrivateKey = getSecret(userId, p256_private_key);
  if (!decryptedP256PrivateKey) {
    throw new Error("Failed to decrypt private key");
  }
  const decryptedSubOrgId = getSecret(userId, sub_organization_id);
  if (!decryptedSubOrgId) {
    throw new Error("Failed to decrypt sub org id");
  }
  const privateKey = await getUserPrivateKey(
    decryptedSubOrgId,
    p256_pub_key,
    decryptedP256PrivateKey,
    ethereum_address,
    p256_pub_key_uncompressed
  );

  const sdk = new Hyperliquid({
    enableWs: false,
    privateKey: privateKey,
    testnet: false,
    walletAddress: ethereum_address,
  });

  return sdk;
};

async function approveBuilderFee(
  sdk: any,
  builderAddress: string,
  maxFeeRate: string
) {
  try {
    const response = await sdk.exchange.approveBuilderFee({
      builder: builderAddress,
      maxFeeRate: maxFeeRate,
    });
    console.log("Builder fee approval response:", response);
    //Builder fee approval response: { status: 'ok', response: { type: 'default' } }
    return response;
  } catch (error) {
    console.error("Error approving builder fee:", error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const sdk = await initializeSdkWithUser(userId);
    const builderAddress = ""; // builder address here
    const maxFeeRate = "1000"; // 0.1% fee cap
    const res = await approveBuilderFee(sdk, builderAddress, maxFeeRate);
    console.log("== BUILDER FEE RES:: ", res);

    return NextResponse.json({ res }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || String(error) },
      { status: 500, headers: corsHeaders }
    );
  }
}
