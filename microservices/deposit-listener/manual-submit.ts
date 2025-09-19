import { triggerGelatoRelay } from "./gelato";
import { supabase } from "@/app/core/supabase";
import { UserProfile } from "@/app/core/types";
import { createPublicClient, http } from "viem";
import { arbitrum } from "viem/chains";
import { USDC_ABI } from "./abi";
import { USDC_ADDRESS } from "./constants";

async function getUsdcBalance(address: string): Promise<bigint> {
  const client = createPublicClient({ chain: arbitrum, transport: http() });
  const balance = await client.readContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });
  return balance as bigint;
}

async function main() {
  // call triggerGelatoRelay manually
  // 1. fetch all the users from supabase
  const { data, error } = await supabase.from("profiles").select("*");

  if (error) {
    console.error("Error fetching profiles:", error);
    return;
  }

  const users = data as UserProfile[];

  // given each users ethereum_address, check their USDC balance on Arbitrum onchain
  for (const user of users) {
    const usdcBalance = await getUsdcBalance(user.ethereum_address);
    // USDC has 6 decimals
    if (usdcBalance > 5_000_000n) {
      console.log(
        `Missed GelatoRelay for ${user.ethereum_address}. USDC balance: ${usdcBalance}. Submitting now...`
      );
      await triggerGelatoRelay(user.ethereum_address, usdcBalance.toString());
    }
  }
}

main();
