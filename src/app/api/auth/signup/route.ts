import { NextRequest, NextResponse } from "next/server";
import { Turnkey, DEFAULT_ETHEREUM_ACCOUNTS } from "@turnkey/sdk-server";

const turnkeyOrgId = process.env.TURNKEY_ORGANIZATION_ID!;
const turnkeyPublicKey = process.env.TURNKEY_PUBLIC_KEY!;
const turnkeyPrivateKey = process.env.TURNKEY_PRIVATE_KEY!;

const turnkeyServer = new Turnkey({
  apiBaseUrl: "https://api.turnkey.com",
  apiPublicKey: turnkeyPublicKey,
  apiPrivateKey: turnkeyPrivateKey,
  defaultOrganizationId: turnkeyOrgId,
}).apiClient();

function withCORS(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*"); // For production, set to your extension's origin
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

export async function OPTIONS() {
  // Handle preflight request
  return withCORS(new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
  const { email, challenge, attestation } = await req.json();

  try {
    const createSubOrgResponse = await turnkeyServer.createSubOrganization({
      subOrganizationName: `${email} - Organization`,
      rootUsers: [
        {
          userName: email,
          userEmail: email,
          apiKeys: [],
          authenticators: [
            {
              authenticatorName: "Default Passkey",
              challenge,
              attestation,
            },
          ],
          oauthProviders: [],
        },
      ],
      rootQuorumThreshold: 1,
      wallet: {
        walletName: "Default Wallet",
        accounts: DEFAULT_ETHEREUM_ACCOUNTS,
      },
    });

    const res = NextResponse.json({
      success: true,
      organizationId: createSubOrgResponse.subOrganizationId,
      walletId: createSubOrgResponse.wallet?.walletId,
      addresses: createSubOrgResponse.wallet?.addresses,
    });
    return withCORS(res);
  } catch (error) {
    return withCORS(
      NextResponse.json(
        { success: false, error: (error as Error).message },
        { status: 500 }
      )
    );
  }
}
