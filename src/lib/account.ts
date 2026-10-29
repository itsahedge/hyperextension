import { isAddress, isHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Secrets } from "./vault";

export type Network = "mainnet" | "testnet";

// master: the account's own key signs everything.
// agent: an approved API wallet signs L1 actions (orders, cancels, leverage,
// agentSendAsset) for `address`; user-signed actions (withdraw, usdClassTransfer,
// approveAgent) still require the master key.
export type SignerMode = "master" | "agent";

export interface AccountConfig {
  // The trading account. All info queries use this, never the agent address.
  address: Address;
  mode: SignerMode;
  network: Network;
}

export function parsePrivateKey(input: string): Hex {
  const value = input.trim();
  const hex = (value.startsWith("0x") ? value : `0x${value}`) as Hex;
  if (!isHex(hex) || hex.length !== 66) {
    throw new Error("Private key must be 32 bytes of hex");
  }
  return hex;
}

export function parseAddress(input: string): Address {
  const value = input.trim();
  if (!isAddress(value)) throw new Error("Invalid address");
  return value;
}

export function addressOf(key: Hex): Address {
  return privateKeyToAccount(key).address;
}

export function signerKey(config: AccountConfig, secrets: Secrets): Hex {
  const key = config.mode === "master" ? secrets.masterKey : secrets.agentKey;
  if (!key) throw new Error(`No ${config.mode} key in vault`);
  return key;
}

// The vault must hold the key the active mode signs with, and a master key
// must belong to the configured account.
export function validateAccount(config: AccountConfig, secrets: Secrets): void {
  signerKey(config, secrets);
  if (secrets.masterKey && addressOf(secrets.masterKey).toLowerCase() !== config.address.toLowerCase()) {
    throw new Error("Master key does not match the account address");
  }
  if (secrets.agentKey && addressOf(secrets.agentKey).toLowerCase() === config.address.toLowerCase()) {
    throw new Error("API wallet key is the account's own key; use master mode instead");
  }
}
