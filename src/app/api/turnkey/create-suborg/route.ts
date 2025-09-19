import { NextRequest, NextResponse } from "next/server";
import {
  Turnkey,
  DEFAULT_ETHEREUM_ACCOUNTS,
  DEFAULT_SOLANA_ACCOUNTS,
} from "@turnkey/sdk-server";
import { TurnkeyClient } from "@turnkey/http";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import { generateP256KeyPair, decryptExportBundle } from "@turnkey/crypto";
import { CreateSubOrgResponse } from "@/lib/turnkey/types";
import { TurnkeyClientHelper } from "@/lib/turnkey";

const turnkeyOrgId = process.env.TURNKEY_ORGANIZATION_ID!;
const turnkeyPublicKey = process.env.TURNKEY_PUBLIC_KEY!;
const turnkeyPrivateKey = process.env.TURNKEY_PRIVATE_KEY!;

const TELEGRAM_BOT_PERMISSION = "telegram-bot";

export const turnkeyClient = new TurnkeyClient(
  { baseUrl: "https://api.turnkey.com" },

  new ApiKeyStamper({
    apiPublicKey: turnkeyPublicKey,
    apiPrivateKey: turnkeyPrivateKey,
  })
);

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
  console.log("==== SENDING POST REQUEST ====");
  const { userId, userEmail } = await req.json();
  const { privateKey, publicKey, publicKeyUncompressed } =
    generateP256KeyPair();

  const subOrgName = `${userId}-${userEmail}`;
  try {
    const createUserResult = await turnkeyClient.createSubOrganization({
      type: "ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V7",
      timestampMs: `${Date.now()}`,
      organizationId: turnkeyOrgId,
      parameters: {
        subOrganizationName: subOrgName,
        rootUsers: [
          {
            userName: String(userId),
            userEmail,
            apiKeys: [
              {
                apiKeyName: TELEGRAM_BOT_PERMISSION,
                publicKey,
                curveType: "API_KEY_CURVE_P256",
              },
            ],
            authenticators: [],
            oauthProviders: [],
          },
        ],
        rootQuorumThreshold: 1,
        wallet: {
          walletName: String(userId),
          accounts: [...DEFAULT_ETHEREUM_ACCOUNTS],
        },
        disableEmailRecovery: false,
        disableEmailAuth: false,
        disableSmsAuth: false,
        disableOtpEmailAuth: false,
      },
    });

    console.log("==== createSubOrganization RESPONSE:", createUserResult);

    const subOrgId =
      createUserResult?.activity.result?.createSubOrganizationResultV7
        ?.subOrganizationId;
    const walletId =
      createUserResult?.activity.result?.createSubOrganizationResultV7?.wallet
        ?.walletId;
    const addresses =
      createUserResult?.activity.result?.createSubOrganizationResultV7?.wallet
        ?.addresses;
    const rootUserIds =
      createUserResult?.activity.result?.createSubOrganizationResultV7
        ?.rootUserIds;

    console.log("==== subOrgId:", subOrgId);
    console.log("==== walletId:", walletId);
    console.log("==== addresses:", addresses);
    console.log("==== rootUserIds:", rootUserIds);

    if (!subOrgId || !walletId || !addresses || !rootUserIds) {
      return withCORS(
        NextResponse.json(
          { success: false, error: "Invalid response from Turnkey" },
          { status: 500 }
        )
      );
    }

    // only continue if we have all the required data
    const turnkeyClientHelper = new TurnkeyClientHelper({
      apiPublicKey: publicKey,
      apiPrivateKey: privateKey,
      organizationId: subOrgId,
    }).getClient();

    const exportEVMResult = await turnkeyClientHelper.exportWalletAccount({
      address: addresses[0],
      targetPublicKey: publicKeyUncompressed,
    });

    console.log("==== exportEVMResult:", exportEVMResult);

    const decrypted = await decryptExportBundle({
      exportBundle: exportEVMResult.exportBundle,
      embeddedKey: privateKey,
      organizationId: subOrgId,
      returnMnemonic: false,
      keyFormat: "HEXADECIMAL",
    });

    console.log("==== decrypted:", decrypted);

    return withCORS(
      NextResponse.json({ success: true, result: createUserResult })
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
