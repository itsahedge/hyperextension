import { getAddress, isAddressEqual, parseUnits, type Address, type Hex } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import { platform } from "@/platform";
import type { Network } from "./account";

// USDC from Arbitrum to HyperCore via Circle CCTP (Hyperliquid docs: "CCTP is
// the preferred method"; the old Arbitrum bridge is deprecated). Flow, per
// Circle's "Transfer USDC from Arbitrum to HyperCore":
//
//   user signs EIP-3009 ReceiveWithAuthorization (USDC -> CctpExtension)
//        │
//   CctpExtension.batchDepositForBurnWithAuth  (one Arbitrum tx, user pays gas)
//        │  burn on Arbitrum (domain 3), mint on HyperEVM (domain 19)
//   CctpForwarder on HyperEVM  ── hookData ──▶  recipient's HyperCore perps/spot
//
// Circle: if mintRecipient or destinationCaller is not the CctpForwarder,
// "funds become permanently stuck and cannot be recovered". assertDepositSafe
// re-checks both immediately before signing.

export const USDC_DECIMALS = 6;
export const ARBITRUM_DOMAIN = 3;
export const HYPEREVM_DOMAIN = 19;
// Fast Transfer (Circle fee API finalityThreshold 1000).
export const FAST_FINALITY = 1000;

export type DepositDex = "perp" | "spot";
// Forwarder hook destinationDexId: 0 = perps, uint32 max = spot.
const DEX_ID: Record<DepositDex, number> = { perp: 0, spot: 0xffffffff };

// Addresses from Circle "HyperCore CCTP-enablement contract addresses" and
// "USDC contract addresses".
export const CCTP_CONFIG = {
  mainnet: {
    chain: arbitrum,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    irisUrl: "https://iris-api.circle.com",
    explorer: "https://arbiscan.io",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    cctpExtension: "0xA95d9c1F655341597C94393fDdc30cf3c08E4fcE",
    cctpForwarder: "0xb21D281DEdb17AE5B501F6AA8256fe38C4e45757",
  },
  testnet: {
    chain: arbitrumSepolia,
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    irisUrl: "https://iris-api-sandbox.circle.com",
    explorer: "https://sepolia.arbiscan.io",
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    cctpExtension: "0x8E4e3d0E95C1bEC4F3eC7F69aa48473E0Ab6eB8D",
    cctpForwarder: "0x02e39ECb8368b41bF68FF99ff351aC9864e5E2a2",
  },
} as const satisfies Record<Network, unknown>;

export type CctpConfig = (typeof CCTP_CONFIG)[Network];

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// Circle's forwarder hook layout:
//   magic "cctp-forward" padded to 24 bytes | version u32 = 0 | dataLength u32 = 24
//   | HyperCore recipient (20 bytes) | destinationDexId u32 (big-endian)
export function encodeForwardHookData(recipient: Address, dex: DepositDex): Hex {
  const magic = hex(new TextEncoder().encode("cctp-forward")).padEnd(48, "0");
  const version = "00000000";
  const dataLength = "00000018";
  const dexId = DEX_ID[dex].toString(16).padStart(8, "0");
  return `0x${magic}${version}${dataLength}${getAddress(recipient).slice(2).toLowerCase()}${dexId}`;
}

export function toBytes32(address: Address): Hex {
  return `0x${getAddress(address).slice(2).toLowerCase().padStart(64, "0")}`;
}

export interface FeeQuote {
  // Basis points of the amount (Circle: "1 = 0.01%").
  minimumFeeBps: number;
  // Flat forwarding fee to HyperCore, USDC base units.
  forwardFee: bigint;
}

// GET /v2/burn/USDC/fees/{src}/{dst}?forward=true&hyperCoreDeposit=true
export function parseFeeQuote(body: unknown): FeeQuote {
  const rows = Array.isArray(body) ? body : [];
  const fast = rows.find((r) => r && typeof r === "object" && (r as { finalityThreshold?: unknown }).finalityThreshold === FAST_FINALITY) as
    | { minimumFee?: unknown; forwardFee?: { high?: unknown } }
    | undefined;
  const bps = Number(fast?.minimumFee);
  const forward = fast?.forwardFee?.high;
  if (!fast || !Number.isFinite(bps) || bps < 0 || typeof forward !== "number" || !Number.isInteger(forward) || forward < 0) {
    throw new Error("Unexpected fee response from Circle");
  }
  return { minimumFeeBps: bps, forwardFee: BigInt(forward) };
}

export async function fetchFeeQuote(cfg: CctpConfig): Promise<FeeQuote> {
  const res = await fetch(platform.route(`${cfg.irisUrl}/v2/burn/USDC/fees/${ARBITRUM_DOMAIN}/${HYPEREVM_DOMAIN}?forward=true&hyperCoreDeposit=true`));
  if (!res.ok) throw new Error(`Circle fee API returned ${res.status}`);
  return parseFeeQuote(await res.json());
}

// Max fee the burn may charge: protocol bps (rounded up) plus forwarding.
export function maxFeeFor(amount: bigint, quote: FeeQuote): bigint {
  const protocol = (amount * BigInt(Math.ceil(quote.minimumFeeBps * 100)) + 999_999n) / 1_000_000n;
  return protocol + quote.forwardFee;
}

export function parseUsdc(input: string): bigint {
  const v = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(v)) throw new Error("Enter a USDC amount with up to 6 decimals");
  const amount = parseUnits(v, USDC_DECIMALS);
  if (amount <= 0n) throw new Error("Amount must be greater than zero");
  return amount;
}

export interface DepositPlan {
  amount: bigint;
  maxFee: bigint;
  // Amount credited on HyperCore if the full max fee is charged.
  minReceived: bigint;
  recipient: Address;
  dex: DepositDex;
  hookData: Hex;
  mintRecipient: Hex;
  destinationCaller: Hex;
}

export function planDeposit(cfg: CctpConfig, input: { amount: bigint; recipient: Address; dex: DepositDex; quote: FeeQuote; balance?: bigint }): DepositPlan {
  const maxFee = maxFeeFor(input.amount, input.quote);
  if (input.amount <= maxFee) throw new Error("Amount must be larger than the fee");
  if (input.balance !== undefined && input.amount > input.balance) throw new Error("Amount is more than your Arbitrum USDC balance");
  const forwarder = toBytes32(cfg.cctpForwarder);
  return {
    amount: input.amount,
    maxFee,
    minReceived: input.amount - maxFee,
    recipient: getAddress(input.recipient),
    dex: input.dex,
    hookData: encodeForwardHookData(input.recipient, input.dex),
    mintRecipient: forwarder,
    destinationCaller: forwarder,
  };
}

// Independent re-check right before signing; any mismatch means funds would
// be stuck or credited to someone else.
export function assertDepositSafe(cfg: CctpConfig, plan: DepositPlan, owner: Address) {
  const forwarder = toBytes32(cfg.cctpForwarder);
  if (plan.mintRecipient !== forwarder || plan.destinationCaller !== forwarder) {
    throw new Error("Refusing deposit: mint recipient and caller must be Circle's CctpForwarder");
  }
  if (!isAddressEqual(plan.recipient, owner)) throw new Error("Refusing deposit: recipient must be this account");
  if (plan.hookData !== encodeForwardHookData(owner, plan.dex)) throw new Error("Refusing deposit: forwarder hook data does not match");
  if (plan.amount <= plan.maxFee) throw new Error("Refusing deposit: amount does not cover the fee");
}

export const CCTP_EXTENSION_ABI = [
  {
    name: "batchDepositForBurnWithAuth",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "_receiveWithAuthorizationData",
        type: "tuple",
        components: [
          { name: "amount", type: "uint256" },
          { name: "authValidAfter", type: "uint256" },
          { name: "authValidBefore", type: "uint256" },
          { name: "authNonce", type: "bytes32" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
      },
      {
        name: "_depositForBurnData",
        type: "tuple",
        components: [
          { name: "amount", type: "uint256" },
          { name: "destinationDomain", type: "uint32" },
          { name: "mintRecipient", type: "bytes32" },
          { name: "destinationCaller", type: "bytes32" },
          { name: "maxFee", type: "uint256" },
          { name: "minFinalityThreshold", type: "uint32" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

export const ERC20_READ_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "version", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

// Authorization window; Circle's example uses one hour either side.
export function authWindow(nowSeconds: number) {
  return { validAfter: BigInt(nowSeconds - 3600), validBefore: BigInt(nowSeconds + 3600) };
}

// The two contract-call argument structs, from a plan and a signature.
export function depositArgs(plan: DepositPlan, auth: { validAfter: bigint; validBefore: bigint; nonce: Hex; signature: Hex }) {
  const sig = auth.signature.slice(2);
  const r = `0x${sig.slice(0, 64)}` as Hex;
  const s = `0x${sig.slice(64, 128)}` as Hex;
  const v = parseInt(sig.slice(128, 130), 16);
  return [
    { amount: plan.amount, authValidAfter: auth.validAfter, authValidBefore: auth.validBefore, authNonce: auth.nonce, v, r, s },
    {
      amount: plan.amount,
      destinationDomain: HYPEREVM_DOMAIN,
      mintRecipient: plan.mintRecipient,
      destinationCaller: plan.destinationCaller,
      maxFee: plan.maxFee,
      minFinalityThreshold: FAST_FINALITY,
      hookData: plan.hookData,
    },
  ] as const;
}
