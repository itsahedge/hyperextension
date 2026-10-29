import { afterEach, describe, expect, it, vi } from "vitest";
import { coinTypeFor, fetchDepositAddress, payloads, UNIT_ASSETS, verifyDepositResponse, type UnitAsset } from "./unit";

// Live Unit testnet /gen responses for Unit's own docs example destination,
// captured 2026-10-29. All three testnet guardians sign each one.
const DST = "0x99a5F7202c4983a6f0Ca9d8F0526Fcd9d2be9e1D";
const EVM_SIGS = {
  "field-node": "+M6gbvBampaqC02+XC/bTyvEcVBRR3h6bOLPBoEy1AOPa3Mi507RmNKGYo8rviqFQrF4v7Np+Boqb1ZuFaz2eQ==",
  "hl-node-testnet": "u4jdXZlUNrEwg+tw3C6UkTCDTBXyCGYbfvrfBfHUcNOcbIizBXEMpZaWVb5geJ5rwD3HNmk8d/2Tb4hMOs226g==",
  "node-1": "ASY7kTsjbBumuP02yAoariTaDmi7afTAWSV4A52r/4PIaEPeBDLFLE8iI4DyzVqSqtWflFFExqK2XFZqMmD2mQ==",
};
const FIXTURES = {
  btc: {
    address: "tb1p4gpqn3undz6zh7w5aj24pdatjevpdg8kqs4ccdu65ddvjr88ljsssjjsdp",
    signatures: {
      "field-node": "GQSf9X6hfBP2YUJ50NlPN7r1oMY+UwmaGHG7iIKashjscDSsWvHKC0utjM1Rnocak30Fk4ulPEarTJ01A2EhRA==",
      "hl-node-testnet": "7WlPbagxt5xVxG+TrfWCbinVW4GqotI0cCOpL9mVrLhOAoNCpFhm5AkFR1AXzcCBjIRqqy37FCouZh7Mr8rmJQ==",
      "node-1": "lW3Ro8YDJzpWHgLyNRcs2Pv+D8iSdD+2146qbHi8KylOnkOhNQqgiez2G+nnu42K4elh0Zo5zwRSugubLdoWpw==",
    },
    status: "OK",
  },
  eth: { address: "0xB9678343aa96c41b6D4ab86F36DbBd1EEF2dc711", signatures: EVM_SIGS, status: "OK" },
  sol: {
    address: "983LcoztTLdzVRr1ykfeoGNkP9oPvefhqTuuprvHcAii",
    signatures: {
      "field-node": "+NwjuLNk8YEhbK/lajbo4tqVVaYqaSss9M0vXFG/rsKl5FOI4H9lcMzu5T8WK/LdI/pmw06aFufMdc+dfjGogw==",
      "hl-node-testnet": "KflvS+s4VzP5NuetDoHIhPzkGzqxxTZ/qQFoZtBAZgffMb/aDPFJlNbmbe9khyPJsoOGKDk1hkCZxc20nHB6Mg==",
      "node-1": "9OqlnE9RDFlZXGRCxTGbtEx/SGsuCljudfcxsguCMjFYaEhIxiBX27uLZsVQCc4qkm4Oh6n9/KSrBW6VHlgi5g==",
    },
    status: "OK",
  },
  // base/virtual returns the same EVM address and signatures as ethereum/eth.
  virtual: { address: "0xB9678343aa96c41b6D4ab86F36DbBd1EEF2dc711", signatures: EVM_SIGS, status: "OK" },
};
const asset = (id: string) => UNIT_ASSETS.find((a) => a.id === id) as UnitAsset;

describe("payloads", () => {
  it("uses coinType ethereum for every EVM chain", () => {
    expect(["ethereum", "plasma", "monad", "avalanche", "base"].map((c) => coinTypeFor(c as never))).toEqual(Array(5).fill("ethereum"));
    expect(coinTypeFor("bitcoin")).toBe("bitcoin");
    expect(coinTypeFor("solana")).toBe("solana");
    expect(coinTypeFor("zcash")).toBe("zcash");
  });

  it("checksums the destination", () => {
    const [current, legacy] = payloads("node-1", asset("btc"), DST.toLowerCase() as `0x${string}`, "tb1x");
    expect(current).toBe(`node-1:user-bitcoin-hyperliquid-${DST}-tb1x`);
    expect(legacy).toBe(`node-1:${DST}-hyperliquid-btc-tb1x-bitcoin-deposit`);
  });
});

describe("verifyDepositResponse", () => {
  it.each(Object.keys(FIXTURES) as (keyof typeof FIXTURES)[])("accepts the live testnet %s address signed by all 3 guardians", async (id) => {
    const res = await verifyDepositResponse("testnet", asset(id), DST, FIXTURES[id]);
    expect(res.address).toBe(FIXTURES[id].address);
    expect(res.verifiedBy.sort()).toEqual(["field-node", "hl-node-testnet", "node-1"]);
  });

  it("accepts the legacy signing format", async () => {
    // Testnet bitcoin address signed over the legacy payload (fixture from the
    // hyperballast/ballast verifier's tests).
    const res = await verifyDepositResponse("testnet", asset("btc"), "0xa6f1Ef42D335Ec7CbfC39f57269c851568300132", {
      address: "tb1pncsdk2979x2nksu5mvf9uu6z0v0a7632ss5vuw3fu4wv8805d09sjd7m3e",
      signatures: {
        "field-node": "KU9w0QF1/lJECrkPSz8ssUmcWpD6ZshftuONYSO/ockUgeovGgmAPKbBBBLt4A0X0WsqaTaFYwEQcRyTGp7xWQ==",
        "hl-node-testnet": "/lElUTMr/4q7QBV6fur2b4LqV7c9DCMDHnMZiC73XO5WOfy46Q+t+2ZmbiPCaW7THLW9r13otiVCjeb/zAfAKA==",
        "node-1": "PXtxH2B/KtCaceEeAD9/pZ37c+Ryv4FmdC7QeN1AB+D1HzjhDtJs75P4Xi3YQB4pP46ycyZkhXnz65AJvFahuA==",
      },
    });
    expect(res.verifiedBy).toHaveLength(3);
  });

  it("refuses a substituted address", async () => {
    const forged = { ...FIXTURES.btc, address: FIXTURES.btc.address.replace(/p$/, "q") };
    await expect(verifyDepositResponse("testnet", asset("btc"), DST, forged)).rejects.toThrow(/only 0 of 3/);
  });

  it("refuses an address signed for a different destination", async () => {
    await expect(verifyDepositResponse("testnet", asset("btc"), "0x0000000000000000000000000000000000000001", FIXTURES.btc)).rejects.toThrow(/only 0 of 3/);
  });

  it("refuses when the coin type does not match the chain", async () => {
    await expect(verifyDepositResponse("testnet", asset("sol"), DST, FIXTURES.eth)).rejects.toThrow(/only 0 of 3/);
  });

  it("refuses testnet signatures under mainnet guardians", async () => {
    await expect(verifyDepositResponse("mainnet", asset("btc"), DST, FIXTURES.btc)).rejects.toThrow(/only 0 of 3/);
  });

  it("needs 2 of 3 guardians", async () => {
    const one = { ...FIXTURES.btc, signatures: { "node-1": FIXTURES.btc.signatures["node-1"], "field-node": "AAAA", "hl-node-testnet": 7 } };
    await expect(verifyDepositResponse("testnet", asset("btc"), DST, one)).rejects.toThrow(/only 1 of 3/);
    const { "node-1": _, ...two } = FIXTURES.btc.signatures;
    expect((await verifyDepositResponse("testnet", asset("btc"), DST, { ...FIXTURES.btc, signatures: two })).verifiedBy).toHaveLength(2);
  });

  it("does not count one guardian's signature for another node", async () => {
    const s = FIXTURES.btc.signatures;
    const shuffled = { "node-1": s["field-node"], "field-node": s["hl-node-testnet"], "hl-node-testnet": s["node-1"] };
    await expect(verifyDepositResponse("testnet", asset("btc"), DST, { ...FIXTURES.btc, signatures: shuffled })).rejects.toThrow(/only 0 of 3/);
  });

  it("surfaces Unit errors and rejects malformed bodies", async () => {
    await expect(verifyDepositResponse("testnet", asset("btc"), DST, { error: "destination address is blocked" })).rejects.toThrow("Unit: destination address is blocked");
    await expect(verifyDepositResponse("testnet", asset("btc"), DST, { status: "OK" })).rejects.toThrow(/Unexpected/);
    await expect(verifyDepositResponse("testnet", asset("btc"), DST, null)).rejects.toThrow(/Unexpected/);
  });
});

describe("fetchDepositAddress", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status: number, body: unknown) => {
    const fetchMock = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("requests the checksummed destination and returns the verified address", async () => {
    const fetchMock = stub(200, FIXTURES.sol);
    const res = await fetchDepositAddress("testnet", asset("sol"), DST.toLowerCase() as `0x${string}`);
    expect(res.address).toBe(FIXTURES.sol.address);
    expect(fetchMock).toHaveBeenCalledWith(`https://api.hyperunit-testnet.xyz/gen/solana/hyperliquid/sol/${DST}`);
  });

  it("explains a Cloudflare 403 and passes through API errors", async () => {
    stub(403, "<html>Attention Required! | Cloudflare</html>");
    await expect(fetchDepositAddress("mainnet", asset("btc"), DST)).rejects.toThrow(/prohibited jurisdictions/);
    stub(400, { error: "unsupported asset", status: "error" });
    await expect(fetchDepositAddress("mainnet", asset("btc"), DST)).rejects.toThrow("Unit: unsupported asset");
    stub(502, "bad gateway");
    await expect(fetchDepositAddress("mainnet", asset("btc"), DST)).rejects.toThrow("Unit API returned 502");
  });
});
