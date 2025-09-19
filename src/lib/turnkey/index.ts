import "dotenv/config";
import { TurnkeyClient } from "@turnkey/http";
import {
  defaultEthereumAccountAtIndex,
  Turnkey,
  DEFAULT_ETHEREUM_ACCOUNTS,
} from "@turnkey/sdk-server";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import { decryptExportBundle, generateP256KeyPair } from "@turnkey/crypto";
import { createOrUpdateSecret } from "./encryptionHelper";
import { HyperliquidClient } from "../hyperliquid";

export const CHROME_EXTENSION_PERMISSION = "chrome-extension";

// Create a Turnkey HTTP client with API key credentials
export const adminTurnkeyClient = new TurnkeyClient(
  { baseUrl: "https://api.turnkey.com" },

  // STAMPER NEEDS TO USE PROJECT ORG IDS, NOT THE USER ORG IDS
  new ApiKeyStamper({
    apiPublicKey: process.env.PLASMO_PUBLIC_TURNKEY_API_PUBLIC_KEY!,
    apiPrivateKey: process.env.PLASMO_PUBLIC_TURNKEY_API_PRIVATE_KEY!,
  })
);

export class AdminTurnkeyClient {
  // this should basically be what the above is..
  private turnkeyClient: TurnkeyClient;

  constructor() {
    this.turnkeyClient = new TurnkeyClient(
      { baseUrl: "https://api.turnkey.com" },

      // STAMPER NEEDS TO USE PROJECT ORG IDS, NOT THE USER ORG IDS
      new ApiKeyStamper({
        apiPublicKey: process.env.PLASMO_PUBLIC_TURNKEY_API_PUBLIC_KEY!,
        apiPrivateKey: process.env.PLASMO_PUBLIC_TURNKEY_API_PRIVATE_KEY!,
      })
    );
  }

  // TODO: when onboarding a user, we need to encrypt the sub org id and private key
  // i need a function i can call to onboard a user..
  async onboardUser(userId: string, userEmail: string) {
    try {
      if (!process.env.PLASMO_PUBLIC_TURNKEY_ORGANIZATION_ID) {
        throw new Error("TURNKEY_ORGANIZATION_ID is not set");
      }

      // 1. Generate a P-256 key pair
      const { privateKey, publicKey, publicKeyUncompressed } =
        generateP256KeyPair();
      const subOrgName = `Hyperliquid-${userEmail}`;

      // 2. Create a sub org
      const createUserResult = await this.turnkeyClient.createSubOrganization({
        type: "ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V7",
        timestampMs: `${Date.now()}`,
        organizationId: process.env.PLASMO_PUBLIC_TURNKEY_ORGANIZATION_ID,
        parameters: {
          subOrganizationName: subOrgName,
          rootUsers: [
            {
              userName: String(userId),
              userEmail,
              apiKeys: [
                {
                  apiKeyName: CHROME_EXTENSION_PERMISSION,
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

      const subOrgId =
        createUserResult?.activity.result?.createSubOrganizationResultV7
          ?.subOrganizationId;
      const walletId =
        createUserResult?.activity.result?.createSubOrganizationResultV7?.wallet
          ?.walletId;
      const addresses =
        createUserResult?.activity.result?.createSubOrganizationResultV7?.wallet
          ?.addresses;
      // const rootUserIds =
      //   createUserResult?.activity.result?.createSubOrganizationResultV7
      //     ?.rootUserIds;

      if (!subOrgId || !walletId || !addresses) {
        throw new Error("Invalid response from Turnkey");
      }

      // TODO: encrypt the sub org id and private key
      const encryptedSubOrgId = createOrUpdateSecret(userId, subOrgId);
      const encryptedPrivateKey = createOrUpdateSecret(userId, privateKey);

      console.log("==== encryptedSubOrgId:", encryptedSubOrgId);
      console.log("==== encryptedPrivateKey:", encryptedPrivateKey);

      return {
        subOrgId: encryptedSubOrgId,
        privateKey: encryptedPrivateKey,
        publicKey,
        walletId,
        publicKeyUncompressed,
        addresses,
      };
    } catch (error) {
      console.error("❌ Failed to create sub organization:", error);
      throw error;
    }
  }
}

export class TurnkeyClientHelper {
  private turnkeyClient: Turnkey;

  constructor({
    apiPublicKey,
    apiPrivateKey,
    organizationId,
  }: {
    apiPublicKey: string;
    apiPrivateKey: string;
    organizationId: string;
  }) {
    this.turnkeyClient = new Turnkey({
      apiBaseUrl: "https://api.turnkey.com",
      defaultOrganizationId: organizationId,
      apiPublicKey,
      apiPrivateKey,
    });
  }

  getClient() {
    return this.turnkeyClient.apiClient();
  }

  async createWallet(subOrganizationId: string) {
    const client = this.getClient();

    // 1. Get the wallet ID
    const { wallets } = await client.getWallets();
    const walletId = wallets[0]?.walletId;
    if (!walletId) {
      throw new Error("No wallet ID found");
    }

    // 2. Choose the account config based on the network
    const defaultAccounts = defaultEthereumAccountAtIndex(
      this.getTimestampBasedRandom()
    );

    // 3. Create a wallet account
    const { addresses } = await client.createWalletAccounts({
      walletId,
      accounts: [defaultAccounts],
    });

    const address = addresses[0];
    if (!address) {
      throw new Error("No address returned from wallet creation");
    }

    // 4. Generate key pair
    const { privateKey, publicKeyUncompressed } = generateP256KeyPair();

    // 5. Export wallet account
    const { exportBundle } = await client.exportWalletAccount({
      address,
      targetPublicKey: publicKeyUncompressed,
    });

    // 6. Decrypt export bundle
    const decryptedBundle = await decryptExportBundle({
      exportBundle,
      embeddedKey: privateKey,
      organizationId: subOrganizationId,
      returnMnemonic: false,
      keyFormat: "HEXADECIMAL",
    });

    // 7. Return result
    return { address, decryptedBundle };
  }

  async createDelegatedApi(
    publicKey: string,
    subOrganizationId: string,
    userId: string
  ): Promise<boolean> {
    const client = this.getClient();

    const { activity } = await client.createApiKeys({
      organizationId: subOrganizationId,
      apiKeys: [
        {
          apiKeyName: CHROME_EXTENSION_PERMISSION,
          publicKey,
          curveType: "API_KEY_CURVE_P256",
        },
      ],
      userId: userId,
    });

    return activity.status === "ACTIVITY_STATUS_COMPLETED";
  }

  async removeDelegatedApis(
    subOrganizationId: string,
    userId: string
  ): Promise<boolean> {
    const client = this.getClient();

    const { apiKeys } = await client.getApiKeys({
      organizationId: subOrganizationId,
    });

    const apiKeyIdsToRemove = apiKeys
      .filter(
        (key) =>
          lowercase(key.apiKeyName) === lowercase(CHROME_EXTENSION_PERMISSION)
      )
      .map((key) => key.apiKeyId);

    if (!apiKeyIdsToRemove.length) {
      return true; // Nothing to remove, treat as success
    }

    try {
      const { activity } = await client.deleteApiKeys({
        userId,
        apiKeyIds: apiKeyIdsToRemove,
      });

      return activity.status === "ACTIVITY_STATUS_COMPLETED";
    } catch (error) {
      console.error("❌ Failed to delete delegated API keys:", error);
      return false;
    }
  }

  getTimestampBasedRandom(): number {
    const now = Date.now(); // current timestamp in milliseconds
    const random = (now % 1000) / 1000; // convert to decimal between 0 and 1
    return Math.floor(random * 340) + 1; // scale to range 1 - 340
  }
}

function lowercase(input: string): string {
  return String(input).toLowerCase();
}

export async function isDelegatedTransactionOn(
  publicKey: string,
  sub_organization_id: string
): Promise<boolean> {
  const keys = await adminTurnkeyClient.getApiKeys({
    organizationId: sub_organization_id,
  });

  return keys.apiKeys.some(
    (key) =>
      lowercase(key.apiKeyName) === lowercase(CHROME_EXTENSION_PERMISSION) &&
      lowercase(key.credential.publicKey) === lowercase(publicKey)
  );
}
