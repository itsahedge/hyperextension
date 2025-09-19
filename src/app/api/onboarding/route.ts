import { NextRequest, NextResponse } from "next/server";
import { AdminTurnkeyClient } from "@/lib/turnkey";

// This endpoint should be called immediately after user signs up
// It will create a Turnkey sub org and a wallet for the user
// 1. First we need to create Turnkey sub org.
// 2. Then we need to create a wallet for the user by generated P256KeyPair.

function withCORS(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

export async function OPTIONS() {
  return withCORS(new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
  const { userId, userEmail } = await req.json();
  try {
    const turnkeyClientHelper = new AdminTurnkeyClient();
    const {
      subOrgId,
      privateKey,
      publicKey,
      walletId,
      addresses,
      rootUserIds,
    } = await turnkeyClientHelper.onboardUser(userId, userEmail);

    console.log("subOrgId", subOrgId);
    console.log("privateKey", privateKey);
    console.log("publicKey", publicKey);
    console.log("walletId", walletId);
    console.log("addresses", addresses);
    console.log("rootUserIds", rootUserIds);

    // save this to the supabase

    // return withCORS(response);
  } catch (error) {
    return withCORS(new NextResponse(null, { status: 500 }));
  }
}
