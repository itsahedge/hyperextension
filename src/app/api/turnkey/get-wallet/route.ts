import { NextRequest, NextResponse } from "next/server";
import { TurnkeyClient } from "@turnkey/http";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import { TurnkeyClientHelper } from "@/lib/turnkey";

const turnkeyPublicKey = process.env.TURNKEY_PUBLIC_KEY!;
const turnkeyPrivateKey = process.env.TURNKEY_PRIVATE_KEY!;

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
  try {
    const { subOrgId } = await req.json();

    // Create a Turnkey client for the sub-organization
    const turnkeyClientHelper = new TurnkeyClientHelper({
      apiPublicKey: turnkeyPublicKey,
      apiPrivateKey: turnkeyPrivateKey,
      organizationId: subOrgId,
    }).getClient();

    // Fetch wallets for the sub-organization
    const walletsResponse = await turnkeyClientHelper.getWallets({
      organizationId: subOrgId,
    });

    let addresses = [];
    if (walletsResponse.wallets && walletsResponse.wallets.length > 0) {
      const walletId = walletsResponse.wallets[0].walletId;
      const accountsResponse = await turnkeyClientHelper.getWalletAccounts({
        walletId,
        organizationId: subOrgId,
      });
      addresses = (accountsResponse.accounts || []).map(
        (account: any) => account.address
      );
    }

    console.log("addresses", addresses);

    return withCORS(
      NextResponse.json({
        success: true,
        // wallets: walletsResponse.wallets,
        addresses,
      })
    );
  } catch (error: any) {
    return withCORS(
      NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    );
  }
}
