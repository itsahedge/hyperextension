import { decodeFunctionData, encodeFunctionData, getAddress, hashTypedData, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  assertDepositSafe,
  CCTP_CONFIG,
  CCTP_EXTENSION_ABI,
  depositArgs,
  encodeForwardHookData,
  maxFeeFor,
  parseFeeQuote,
  parseUsdc,
  planDeposit,
  RECEIVE_WITH_AUTHORIZATION_TYPES,
  toBytes32,
} from "./cctp";

// Well-known Anvil/Hardhat development key. Never fund it.
const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const cfg = CCTP_CONFIG.testnet;
const quote = { minimumFeeBps: 0, forwardFee: 200_000n };

// Circle's reference encoder, transcribed verbatim from "Transfer USDC from
// Arbitrum to HyperCore", used as the oracle for our encoder.
function circleReference(recipient: `0x${string}`, dex: number): `0x${string}` {
  const magicHex = Buffer.from("cctp-forward", "utf-8").toString("hex").padEnd(48, "0");
  const address = recipient.slice(2).toLowerCase();
  const d = (dex >>> 0).toString(16).padStart(8, "0");
  return `0x${magicHex}00000000${"00000018"}${address}${d}`;
}

describe("forwarder hook data", () => {
  it("matches Circle's reference encoding for perps and spot", () => {
    expect(encodeForwardHookData(owner.address, "perp")).toBe(circleReference(owner.address, 0));
    expect(encodeForwardHookData(owner.address, "spot")).toBe(circleReference(owner.address, 4294967295));
  });

  it("is 56 bytes with the recipient at byte 32 and dex at byte 52", () => {
    const h = encodeForwardHookData(owner.address, "spot").slice(2);
    expect(h.length).toBe(56 * 2);
    expect(Buffer.from(h.slice(0, 24), "hex").toString()).toBe("cctp-forward");
    expect(`0x${h.slice(64, 104)}`).toBe(owner.address.toLowerCase());
    expect(h.slice(104)).toBe("ffffffff");
  });
});

describe("fees and amounts", () => {
  it("parses Circle's fast-transfer quote", () => {
    const body = [
      { finalityThreshold: 1000, minimumFee: 0, forwardFee: { low: 200000, med: 200000, high: 200000 } },
      { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 200000, med: 200000, high: 200000 } },
    ];
    expect(parseFeeQuote(body)).toEqual({ minimumFeeBps: 0, forwardFee: 200_000n });
    expect(() => parseFeeQuote([{ finalityThreshold: 2000, minimumFee: 0 }])).toThrow(/Unexpected/);
    expect(() => parseFeeQuote({ error: "x" })).toThrow(/Unexpected/);
  });

  it("adds protocol bps (rounded up) to the forwarding fee", () => {
    expect(maxFeeFor(10_000_000n, quote)).toBe(200_000n);
    // 1 bps of 10 USDC = 0.001 USDC = 1000 units.
    expect(maxFeeFor(10_000_000n, { minimumFeeBps: 1, forwardFee: 200_000n })).toBe(201_000n);
    // 1.3 bps of 1 unit rounds up to 1 unit.
    expect(maxFeeFor(1n, { minimumFeeBps: 1.3, forwardFee: 0n })).toBe(1n);
  });

  it("parses USDC to 6 decimals and rejects bad input", () => {
    expect(parseUsdc("10")).toBe(10_000_000n);
    expect(parseUsdc(" 0.000001 ")).toBe(1n);
    expect(() => parseUsdc("1.0000001")).toThrow(/6 decimals/);
    expect(() => parseUsdc("0")).toThrow(/greater than zero/);
    expect(() => parseUsdc("1e3")).toThrow();
  });
});

describe("planDeposit / assertDepositSafe", () => {
  const plan = planDeposit(cfg, { amount: 10_000_000n, recipient: owner.address, dex: "perp", quote, balance: 50_000_000n });

  it("routes to Circle's CctpForwarder and credits the owner", () => {
    expect(plan.mintRecipient).toBe(toBytes32(cfg.cctpForwarder));
    expect(plan.destinationCaller).toBe(toBytes32(cfg.cctpForwarder));
    expect(plan.minReceived).toBe(9_800_000n);
    expect(() => assertDepositSafe(cfg, plan, owner.address)).not.toThrow();
  });

  it("refuses anything that would strand or misdirect funds", () => {
    const other = getAddress("0x2222222222222222222222222222222222222222");
    expect(() => assertDepositSafe(cfg, { ...plan, mintRecipient: toBytes32(other) }, owner.address)).toThrow(/CctpForwarder/);
    expect(() => assertDepositSafe(cfg, { ...plan, destinationCaller: toBytes32(other) }, owner.address)).toThrow(/CctpForwarder/);
    expect(() => assertDepositSafe(cfg, plan, other)).toThrow(/this account/);
    expect(() => assertDepositSafe(cfg, { ...plan, hookData: encodeForwardHookData(other, "perp") }, owner.address)).toThrow(/hook/);
    expect(() => assertDepositSafe(CCTP_CONFIG.mainnet, plan, owner.address)).toThrow(/CctpForwarder/);
  });

  it("rejects amounts at or below the fee and above the balance", () => {
    expect(() => planDeposit(cfg, { amount: 200_000n, recipient: owner.address, dex: "perp", quote })).toThrow(/larger than the fee/);
    expect(() => planDeposit(cfg, { amount: 60_000_000n, recipient: owner.address, dex: "perp", quote, balance: 50_000_000n })).toThrow(/balance/);
  });
});

describe("transaction encoding", () => {
  it("encodes calldata that decodes back to the planned values", async () => {
    const plan = planDeposit(cfg, { amount: 10_000_000n, recipient: owner.address, dex: "spot", quote });
    const auth = { validAfter: 1n, validBefore: 2n, nonce: `0x${"ab".repeat(32)}` as Hex };
    const message = { from: owner.address, to: cfg.cctpExtension, value: plan.amount, ...auth };
    const domain = { name: "USD Coin", version: "2", chainId: cfg.chain.id, verifyingContract: cfg.usdc } as const;
    const signature = await owner.signTypedData({ domain, types: RECEIVE_WITH_AUTHORIZATION_TYPES, primaryType: "ReceiveWithAuthorization", message });
    expect(await recoverTypedDataAddress({ domain, types: RECEIVE_WITH_AUTHORIZATION_TYPES, primaryType: "ReceiveWithAuthorization", message, signature })).toBe(owner.address);
    expect(hashTypedData({ domain, types: RECEIVE_WITH_AUTHORIZATION_TYPES, primaryType: "ReceiveWithAuthorization", message })).toMatch(/^0x[0-9a-f]{64}$/);

    const data = encodeFunctionData({ abi: CCTP_EXTENSION_ABI, functionName: "batchDepositForBurnWithAuth", args: depositArgs(plan, { ...auth, signature }) });
    const { args } = decodeFunctionData({ abi: CCTP_EXTENSION_ABI, data });
    const [authData, burn] = args;
    expect(authData).toMatchObject({ amount: 10_000_000n, authValidAfter: 1n, authValidBefore: 2n, authNonce: auth.nonce });
    expect(`0x${authData.r.slice(2)}${authData.s.slice(2)}${authData.v.toString(16)}`).toBe(signature);
    expect(burn).toMatchObject({
      amount: 10_000_000n,
      destinationDomain: 19,
      mintRecipient: toBytes32(cfg.cctpForwarder),
      destinationCaller: toBytes32(cfg.cctpForwarder),
      maxFee: 200_000n,
      minFinalityThreshold: 1000,
      hookData: encodeForwardHookData(owner.address, "spot"),
    });
  });
});
