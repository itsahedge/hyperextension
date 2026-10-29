import { ApproveAgentTypes, UsdClassTransferTypes, Withdraw3Types } from "@nktkas/hyperliquid/api/exchange";
import { signUserSignedAction } from "@nktkas/hyperliquid/signing";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

// Hyperliquid's user-signed EIP-712 primary types contain a colon
// ("HyperliquidTransaction:Withdraw"). viem 2.57.12 started rejecting such
// struct names, which broke withdraw, transfers, and approveAgent at runtime.
// These run fully offline and fail if a viem upgrade reintroduces that check.

// Well-known Anvil/Hardhat development key. Never fund it.
const wallet = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const base = { signatureChainId: "0x1" as const, hyperliquidChain: "Testnet" };

async function signsAndRecovers(types: Record<string, { name: string; type: string }[]>, action: Record<string, unknown>) {
  const signature = await signUserSignedAction({ wallet, action: action as never, types });
  const primaryType = Object.keys(types)[0]!;
  const message = Object.fromEntries(types[primaryType]!.map((f) => [f.name, action[f.name]]));
  const recovered = await recoverTypedDataAddress({
    domain: { name: "HyperliquidSignTransaction", version: "1", chainId: 1, verifyingContract: "0x0000000000000000000000000000000000000000" },
    types,
    primaryType,
    message,
    signature: `0x${signature.r.slice(2)}${signature.s.slice(2)}${signature.v.toString(16)}`,
  });
  expect(recovered).toBe(wallet.address);
}

describe("user-signed EIP-712 actions sign with a viem local account", () => {
  it("approveAgent", async () => {
    await signsAndRecovers(ApproveAgentTypes, {
      type: "approveAgent",
      ...base,
      agentAddress: "0x0000000000000000000000000000000000000001",
      agentName: "hyperext",
      nonce: 1_700_000_000_000,
    });
  });

  it("withdraw3", async () => {
    await signsAndRecovers(Withdraw3Types, {
      type: "withdraw3",
      ...base,
      destination: wallet.address,
      amount: "10",
      time: 1_700_000_000_000,
    });
  });

  it("usdClassTransfer", async () => {
    await signsAndRecovers(UsdClassTransferTypes, {
      type: "usdClassTransfer",
      ...base,
      amount: "10",
      toPerp: true,
      nonce: 1_700_000_000_000,
    });
  });
});
