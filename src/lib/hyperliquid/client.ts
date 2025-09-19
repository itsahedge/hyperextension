import { supabase } from "@/app/core/supabase";
import { getSecret } from "../turnkey/encryptionHelper";
import { getUserPrivateKey } from "@/lib/turnkey/private-key";
import { Hyperliquid } from "hyperliquid";
import { UserProfile } from "@/app/core/types";

export class HyperliquidClient {
  private readonly userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  // Initialize the SDK with a user's private key decrypted from Supabase
  initializeSdkWithUser = async (userId: string) => {
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

  // If we already have the decrypted private key, we can initialize the SDK with it (onboarding flow)
  initializeSdkWithPrivateKey = async (
    privateKey: string,
    walletAddress: string
  ) => {
    const sdk = new Hyperliquid({
      enableWs: false,
      privateKey: privateKey,
      testnet: false,
      walletAddress: walletAddress,
    });

    return sdk;
  };
}
