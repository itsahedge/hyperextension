import { NextRequest, NextResponse } from "next/server";
import { TurnkeyClient } from "@turnkey/http";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import { createAccount } from "@turnkey/viem";
import { createWalletClient, fallback, http } from "viem";
import { arbitrum } from "viem/chains";

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

    const userPrivateKey = "";
    const userPublicKey = "";

    const user_stamper = new ApiKeyStamper({
      apiPublicKey: userPublicKey,
      apiPrivateKey: userPrivateKey,
    });
    const httpClient = new TurnkeyClient(
      { baseUrl: "https://api.turnkey.com" },
      user_stamper
    );

    // Create the Viem custom account
    const turnkeyAccount = await createAccount({
      client: httpClient,
      organizationId: subOrgId,
      signWith: userPublicKey,
      ethereumAddress: userPublicKey,
    });

    const walletClient = createWalletClient({
      account: turnkeyAccount,
      chain: arbitrum,
      transport: (fallback as any)([http("https://arb1.arbitrum.io/rpc")]),
    });
    console.log("walletClient", walletClient);

    const payload: any = {
      owner: "", // The address of the user with funds they want to deposit
      spender: "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7", // The address of the bridge 0x2df1c51e09aecf9cacb7bc98cb1742757f163df7 on mainnet and 0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89 on testnet
      value: 10000000,
      nonce: 1,
      deadline: 1751096179,
    };

    const isMainnet = true;

    const domain = {
      name: isMainnet ? "USD Coin" : "USDC2",
      version: isMainnet ? "2" : "1",
      chainId: isMainnet ? 42161 : 421614,
      verifyingContract: isMainnet
        ? "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
        : "0x1baAbB04529D43a73232B713C0FE471f7c7334d5",
    };

    const permitTypes = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const dataToSign = {
      domain,
      types: permitTypes,
      primaryType: "Permit",
      message: payload,
    } as const;

    // EIP-712 signing
    const signature = await walletClient.signTypedData(dataToSign as any);

    console.log("signature", signature);

    return withCORS(
      NextResponse.json({
        success: true,
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
