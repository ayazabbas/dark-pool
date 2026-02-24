/**
 * DarkPool Deploy Script
 *
 * Declares and deploys the DarkPool contract to Starknet Sepolia.
 * Usage: npx ts-node scripts/deploy.ts
 *
 * Required env vars:
 *   STARKNET_RPC_URL - Starknet RPC endpoint
 *   DEPLOYER_PRIVATE_KEY - Private key for deployment account
 *   DEPLOYER_ADDRESS - Account address
 */

import {
  Account,
  RpcProvider,
  json,
  Contract,
  CallData,
  cairo,
} from "starknet";
import * as fs from "fs";
import * as path from "path";

// Config
const RPC_URL = process.env.STARKNET_RPC_URL || "https://starknet-sepolia.public.blastapi.io";
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY!;
const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS!;
const STRK_ADDRESS = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

// Market defaults
const FIXED_ESCROW = cairo.uint256(10n * 10n ** 18n); // 10 STRK
const COMMIT_DURATION = 150; // 2.5 min
const CLOSED_DURATION = 150; // 2.5 min
const REVEAL_DURATION = 300; // 5 min

async function main() {
  if (!PRIVATE_KEY || !DEPLOYER_ADDRESS) {
    console.error("Missing DEPLOYER_PRIVATE_KEY or DEPLOYER_ADDRESS env vars");
    process.exit(1);
  }

  console.log("Connecting to Starknet Sepolia...");
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const account = new Account(provider, DEPLOYER_ADDRESS, PRIVATE_KEY);

  // Load compiled contract
  const contractDir = path.join(__dirname, "..", "contracts", "target", "dev");
  const sierraPath = path.join(contractDir, "darkpool_DarkPool.contract_class.json");
  const casmPath = path.join(contractDir, "darkpool_DarkPool.compiled_contract_class.json");

  if (!fs.existsSync(sierraPath) || !fs.existsSync(casmPath)) {
    console.error("Contract artifacts not found. Run 'scarb build' in contracts/ first.");
    process.exit(1);
  }

  const sierra = json.parse(fs.readFileSync(sierraPath, "utf-8"));
  const casm = json.parse(fs.readFileSync(casmPath, "utf-8"));

  // Declare
  console.log("Declaring DarkPool contract...");
  try {
    const declareResponse = await account.declare({ contract: sierra, casm });
    console.log("Declare tx:", declareResponse.transaction_hash);
    console.log("Class hash:", declareResponse.class_hash);
    await provider.waitForTransaction(declareResponse.transaction_hash);
    console.log("Declaration confirmed!");

    // Deploy
    const now = Math.floor(Date.now() / 1000);
    const strikePrice = 9741230; // placeholder — keeper will create markets with real prices

    console.log("Deploying DarkPool contract...");
    const deployResponse = await account.deploy({
      classHash: declareResponse.class_hash,
      constructorCalldata: CallData.compile({
        market_id: 0,
        bet_token: STRK_ADDRESS,
        fixed_escrow: FIXED_ESCROW,
        strike_price: strikePrice,
        strike_price_expo: -2,
        start_time: now,
        commit_duration: COMMIT_DURATION,
        closed_duration: CLOSED_DURATION,
        reveal_duration: REVEAL_DURATION,
        owner: DEPLOYER_ADDRESS,
        fee_collector: DEPLOYER_ADDRESS,
      }),
    });

    console.log("Deploy tx:", deployResponse.transaction_hash);
    await provider.waitForTransaction(deployResponse.transaction_hash);
    console.log("Contract deployed at:", deployResponse.contract_address);
    console.log("\nDone! Add this to your .env:");
    console.log(`DARKPOOL_ADDRESS=${deployResponse.contract_address}`);

  } catch (err: any) {
    if (err.message?.includes("already declared")) {
      console.log("Contract already declared. Use the existing class hash to deploy.");
    } else {
      throw err;
    }
  }
}

main().catch(console.error);
