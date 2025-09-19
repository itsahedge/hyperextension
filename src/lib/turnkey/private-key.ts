import { TurnkeyClientHelper } from "@/lib/turnkey";
import { decryptExportBundle } from "@turnkey/crypto";
import { checksumAddress } from "viem";

export const getUserPrivateKey = async (
  subOrgId: string,
  p256_pub_key: string,
  p256_priv_key: string,
  userEthereumAddress: string,
  publicKeyUncompressed: string
): Promise<string> => {
  const userAddress = checksumAddress(userEthereumAddress as `0x${string}`);

  // GIVEN A SPECIFIC USER ADDRESS, SUBMIT GELATO ORDER
  // only continue if we have all the required data
  const turnkeyClientHelper = new TurnkeyClientHelper({
    apiPublicKey: p256_pub_key,
    apiPrivateKey: p256_priv_key,
    organizationId: subOrgId,
  }).getClient();

  // This needs to be checksummed address
  const exportEVMResult = await turnkeyClientHelper.exportWalletAccount({
    address: userAddress,
    targetPublicKey: publicKeyUncompressed,
  });

  // console.log("exportEVMResult", exportEVMResult);

  const decrypted = await decryptExportBundle({
    exportBundle: exportEVMResult.exportBundle,
    embeddedKey: p256_priv_key,
    organizationId: subOrgId,
    returnMnemonic: false,
    keyFormat: "HEXADECIMAL",
  });
  return decrypted;
};
