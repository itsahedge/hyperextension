import "dotenv/config";
import { createPublicClient, webSocket } from "viem";
import { arbitrum } from "viem/chains";
import { USDC_ABI } from "./abi";
import { supabase } from "@/app/core/supabase";
import { USDC_ADDRESS } from "./constants";
import { triggerGelatoRelay } from "./gelato";

// 1) get all the addresses from the supabase database
// 2) periodically check for new addresses (every 1 minute) update the depositAddresses set
// 3) listen for USDC transfers to the depositAddresses set
// 4) if a transfer is detected to an address belonging to the depositAddresses set (user deposited USDC), trigger Gelato Relay to send the USDC on behalf of the User to Hyperliquid bridge.
// 5) if the transfer is not detected, log an error
// 6) if the transfer is detected, log the transfer

const transport = webSocket(process.env.PLASMO_PUBLIC_QUICKNODE_RPC_ENDPOINT!, {
  methods: {
    include: ["transfer"],
  },
});

const provider = createPublicClient({
  chain: arbitrum,
  transport: transport,
});

async function getAllDepositAddresses() {
  const { data, error } = await supabase
    .from("profiles")
    .select("ethereum_address");

  if (error) {
    throw new Error("Failed to fetch addresses: " + error.message);
  }

  // Return addresses exactly as they are in the database
  return data?.map((row) => row.ethereum_address);
}

let depositAddresses = new Set<string>();

async function refreshDepositAddresses() {
  try {
    const addresses = await getAllDepositAddresses();
    // Convert all addresses to lowercase before adding to the set
    depositAddresses = new Set(addresses.map((addr) => addr.toLowerCase()));
    console.log("Deposit addresses updated:", depositAddresses);
  } catch (err) {
    console.error("Failed to refresh deposit addresses:", err);
  }
}

async function main() {
  console.log("===== STARTING MICROSERVICE: DEPOSIT LISTENER =====");

  // Initial load
  await refreshDepositAddresses();

  // Refresh every minute
  setInterval(refreshDepositAddresses, 60 * 1000);

  console.log(">>> Refreshing deposit address list every 1 minute");
  console.log(
    `>>> Listening for USDC transfers to deposit (${depositAddresses.size}) addresses...`
  );

  provider.watchEvent({
    address: USDC_ADDRESS,
    event: USDC_ABI[0],
    onLogs: (logs) => {
      for (const log of logs) {
        const { args } = log;
        const to = (args as any).to.toLowerCase();
        if (depositAddresses.has(to)) {
          console.log(
            `USDC deposit detected! To: ${to}, From: ${
              (args as any).from
            }, Value: ${(args as any).value}, Tx: ${log.transactionHash}`
          );

          // 1. the address of the user who deposited the USDC
          // 2. the amount of USDC deposited (MUST BE LARGER THAN 5 USDC)
          if ((args as any).value < 5000000) {
            console.log(`Value is less than 5 USDC, skipping Gelato Relay`);
            return;
          }
          triggerGelatoRelay(to, (args as any).value).catch((err) => {
            console.error("Error in triggerGelatoRelay:", err);
          });
        }
      }
    },
  });
}

main().catch((err) => {
  console.error("Listener error:", err);
  process.exit(1);
});
