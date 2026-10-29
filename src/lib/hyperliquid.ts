import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Network } from "./account";

const transports = new Map<Network, HttpTransport>();

function transport(network: Network): HttpTransport {
  let t = transports.get(network);
  if (!t) {
    t = new HttpTransport({ isTestnet: network === "testnet" });
    transports.set(network, t);
  }
  return t;
}

export function infoClient(network: Network): InfoClient {
  return new InfoClient({ transport: transport(network) });
}

export function exchangeClient(network: Network, key: Hex): ExchangeClient {
  return new ExchangeClient({ transport: transport(network), wallet: privateKeyToAccount(key) });
}
