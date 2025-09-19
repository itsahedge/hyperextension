import "dotenv/config";
import { TurnkeyClient } from "@turnkey/http";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import { supabase } from "@/app/core/supabase";
import { createAccount } from "@turnkey/viem";
import {
  createWalletClient,
  fallback,
  http,
  createPublicClient,
  encodeFunctionData,
} from "viem";
import { arbitrum } from "viem/chains";
import { BATCHED_DEPOSIT_WITH_PERMIT_ABI } from "./abi";
import { HYPERLIQUID_BRIDGE_ADDRESS, USDC_ADDRESS } from "./constants";
import { GelatoRelay } from "@gelatonetwork/relay-sdk-viem";
import { checksumAddress } from "viem";
import { UserProfile } from "@/app/core/types";
import { getSecret } from "@/lib/turnkey/encryptionHelper";

// TODO: need to actually test
export async function triggerGelatoRelay(userAddress: string, value: string) {
  // need to turn value to bigint
  const valueBigInt = BigInt(value);
  console.log(
    `>>> Triggering Gelato Relay for USDC deposit! To: ${userAddress}, Value: ${value}`
  );
  console.log(">> valueBigInt: ", valueBigInt);

  // TODO: what if i passed the user id or entire user instance from Supabase?
  // then i wouldnt need to query the database again. for now its okay.
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("ethereum_address", userAddress);
  console.log("data", data);
  console.log("error", error);

  if (!data) {
    throw new Error("No data found");
  }

  const userData = data[0] as UserProfile;

  if (!userData) {
    throw new Error("No user data found");
  }

  console.log(">>>> userData: ", userData);

  // TODO: should define the type for userData
  const {
    id,
    p256_pub_key,
    p256_private_key, // encrypted
    sub_organization_id, // encrypted
    ethereum_address,
    p256_pub_key_uncompressed,
  } = userData;

  const checksummedEthereumAddress = checksumAddress(
    ethereum_address as `0x${string}`
  );

  const decryptedSubOrganizationId = getSecret(id, sub_organization_id);
  if (!decryptedSubOrganizationId) {
    throw new Error("No decrypted sub organization id found");
  }

  const decryptedPrivateKey = getSecret(id, p256_private_key);
  if (!decryptedPrivateKey) {
    throw new Error("No decrypted private key found");
  }

  // Use the user's P-256 keypair for API authentication
  const user_stamper = new ApiKeyStamper({
    apiPublicKey: p256_pub_key,
    apiPrivateKey: decryptedPrivateKey,
  });
  const httpClient = new TurnkeyClient(
    { baseUrl: "https://api.turnkey.com" },
    user_stamper
  );
  const turnkeyAccount = await createAccount({
    client: httpClient,
    organizationId: decryptedSubOrganizationId,
    signWith: checksummedEthereumAddress,
    ethereumAddress: checksummedEthereumAddress,
  });

  // Then create a wallet client
  const walletClient = createWalletClient({
    account: turnkeyAccount,
    chain: arbitrum,
    transport: (fallback as any)([
      http(process.env.PLASMO_PUBLIC_QUICKNODE_RPC_ENDPOINT),
    ]),
  });
  const client = createPublicClient({ chain: arbitrum, transport: http() });
  const usdcAbi = [
    {
      inputs: [{ internalType: "address", name: "owner", type: "address" }],
      name: "nonces",
      outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
  ];
  const nonce = await client.readContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: "nonces",
    args: [checksummedEthereumAddress],
  });
  console.log("USDC nonce for address:", nonce);
  console.log(
    "================================================================"
  );

  // set deadline for 1 hour from now (unix timestamp)
  const now = new Date();
  // Add 1 hour (3600 seconds * 1000 ms) to the current time
  const oneHourFromNow = new Date(now.getTime() + 3600 * 1000);
  const unixTimestamp = Math.floor(oneHourFromNow.getTime() / 1000);

  // 2) sign typed data with EIP-712
  const payload: any = {
    owner: checksummedEthereumAddress, // The address of the user with funds they want to deposit
    spender: HYPERLIQUID_BRIDGE_ADDRESS, // The address of the bridge 0x2df1c51e09aecf9cacb7bc98cb1742757f163df7 on mainnet and 0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89 on testnet
    value: valueBigInt, // TODO: change
    nonce: nonce, // TODO: verify nonce
    deadline: unixTimestamp, // TODO: dynamically handle setting deadline for 1hr ahead
  };

  // This is the last thing that gets logged
  console.log(">> payload: ", payload);

  const domain = {
    name: "USD Coin",
    version: "2",
    chainId: 42161,
    verifyingContract: USDC_ADDRESS,
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

  console.log(">>>> dataToSign: ", dataToSign);
  console.log(">>>> right before walletClient.signTypedData(dataToSign)");
  // EIP-712 signing
  const signature = await walletClient.signTypedData(dataToSign as any);
  console.log("signature", signature);

  const abi = BATCHED_DEPOSIT_WITH_PERMIT_ABI;

  // Parse the EIP-712 signature into r, s, v
  const sig = signature.startsWith("0x") ? signature.slice(2) : signature;
  const r = "0x" + sig.slice(0, 64);
  const s = "0x" + sig.slice(64, 128);
  const v = parseInt(sig.slice(128, 130), 16);

  const contractAddress = HYPERLIQUID_BRIDGE_ADDRESS;
  const deposits = [
    {
      user: checksummedEthereumAddress,
      usd: valueBigInt, // TODO: should be the same as amount of USDC deposited
      deadline: unixTimestamp, // TODO: should be the same as deadline
      signature: {
        r,
        s,
        v,
      },
    },
  ];

  console.log(">> deposits: ", deposits);

  const GELATO_API_KEY = process.env.PLASMO_PUBLIC_GELATO_API_KEY;
  if (!GELATO_API_KEY) {
    throw new Error("GELATO_API_KEY is not set");
  }

  console.log(">>>> right before encodeFunctionData");

  const encodedData = encodeFunctionData({
    abi,
    functionName: "batchedDepositWithPermit",
    args: [deposits],
  });
  console.log("encoded data: ", encodedData);

  const relay = new GelatoRelay();
  const relayResponse = await relay.sponsoredCall(
    {
      chainId: 42161n, // Arbitrum One
      target: contractAddress,
      data: encodedData,
    },
    GELATO_API_KEY
  );

  console.log("Gelato relay response:", relayResponse);
}
