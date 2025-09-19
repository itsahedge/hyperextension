import { GenerateDepositAddressResponse } from "./types";

// lol, hyperunit blocks requests from US IP addresses....
export class HyperunitClient {
  baseUrl: string;

  constructor() {
    this.baseUrl = "https://api.hyperunit.xyz";
  }

  /**
   * Generate a deposit address using the /gen/:src_chain/hyperliquid/:asset/:dst_addr endpoint
   * @param srcChain Source chain ("bitcoin", "solana", "ethereum", or "hyperliquid")
   * @param asset Asset symbol ("btc", "eth", "sol", or "fart")
   * @param dstAddr Destination address (string)
   * @returns The response from the Hyperunit API
   */
  async generateDepositAddress(
    srcChain: string,
    asset: string,
    dstAddr: string
  ): Promise<GenerateDepositAddressResponse> {
    const url = `${this.baseUrl}/gen/${encodeURIComponent(
      srcChain
    )}/hyperliquid/${encodeURIComponent(asset)}/${encodeURIComponent(dstAddr)}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`HTTP error: ${res.status}`);
    }
    return res.json();
  }
}
