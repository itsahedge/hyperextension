import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { platform } from "@/platform";
import type { Network } from "./account";
import {
  assertDepositSafe,
  authWindow,
  CCTP_CONFIG,
  CCTP_EXTENSION_ABI,
  depositArgs,
  ERC20_READ_ABI,
  RECEIVE_WITH_AUTHORIZATION_TYPES,
  type DepositPlan,
} from "./cctp";
import { randomBytes } from "./vault";

function publicClient(network: Network) {
  const cfg = CCTP_CONFIG[network];
  return createPublicClient({ chain: cfg.chain, transport: http(platform.route(cfg.rpcUrl)) });
}

export async function arbitrumBalances(network: Network, owner: Address) {
  const cfg = CCTP_CONFIG[network];
  const client = publicClient(network);
  const [usdc, eth] = await Promise.all([
    client.readContract({ address: cfg.usdc, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [owner] }),
    client.getBalance({ address: owner }),
  ]);
  return { usdc, eth };
}

// Signs the USDC authorization and submits batchDepositForBurnWithAuth from
// the master key. Simulates first so a revert costs no gas. Returns once the
// Arbitrum tx is mined.
export async function submitDeposit(network: Network, masterKey: Hex, plan: DepositPlan): Promise<{ hash: Hex; status: "success" | "reverted" }> {
  const cfg = CCTP_CONFIG[network];
  const account = privateKeyToAccount(masterKey);
  assertDepositSafe(cfg, plan, account.address);

  const client = publicClient(network);
  const wallet = createWalletClient({ account, chain: cfg.chain, transport: http(platform.route(cfg.rpcUrl)) });

  // The token's EIP-712 domain, read from the contract rather than assumed.
  const [name, version, balance] = await Promise.all([
    client.readContract({ address: cfg.usdc, abi: ERC20_READ_ABI, functionName: "name" }),
    client.readContract({ address: cfg.usdc, abi: ERC20_READ_ABI, functionName: "version" }),
    client.readContract({ address: cfg.usdc, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [account.address] }),
  ]);
  if (balance < plan.amount) throw new Error("Not enough USDC on Arbitrum");

  const { validAfter, validBefore } = authWindow(Math.floor(Date.now() / 1000));
  const nonce = `0x${Array.from(randomBytes(32), (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
  const signature = await wallet.signTypedData({
    domain: { name, version, chainId: cfg.chain.id, verifyingContract: cfg.usdc },
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: { from: account.address, to: cfg.cctpExtension, value: plan.amount, validAfter, validBefore, nonce },
  });

  const { request } = await client.simulateContract({
    account,
    address: cfg.cctpExtension,
    abi: CCTP_EXTENSION_ABI,
    functionName: "batchDepositForBurnWithAuth",
    args: depositArgs(plan, { validAfter, validBefore, nonce, signature }),
  });
  const hash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash });
  return { hash, status: receipt.status };
}
