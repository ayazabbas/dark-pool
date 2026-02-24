import { Contract, CallData, type Abi, json } from "starknet";
import { config } from "../config.js";
import { account, provider } from "./starknet.js";
import { fetchBtcPrice } from "./pyth.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load Factory ABI
const sierraPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "contracts",
  "target",
  "dev",
  "darkpool_DarkPoolFactory.contract_class.json"
);

let factoryAbi: Abi;
try {
  const sierra = json.parse(fs.readFileSync(sierraPath, "utf-8"));
  factoryAbi = sierra.abi;
} catch {
  console.warn("Warning: Could not load Factory ABI from contracts build output");
  factoryAbi = [];
}

function getFactoryContract(): Contract {
  const contract = new Contract(factoryAbi, config.factoryAddress, provider);
  contract.connect(account);
  return contract;
}

export async function getMarketCount(): Promise<number> {
  const contract = getFactoryContract();
  const count = await contract.get_market_count();
  return Number(count);
}

export async function getMarketAddress(marketId: number): Promise<string> {
  const contract = getFactoryContract();
  const addr = await contract.get_market(marketId);
  return `0x${BigInt(addr).toString(16)}`;
}

/**
 * Create a new market via the factory contract.
 * Fetches current BTC/USD price from Pyth to use as strike price.
 */
export async function createMarket(): Promise<{ txHash: string; marketId: number }> {
  const { price, expo } = await fetchBtcPrice();

  const factory = getFactoryContract();
  const currentCount = await factory.get_market_count();
  const nextId = Number(currentCount) + 1;

  const result = await factory.invoke("create_market", [
    config.strkAddress,           // bet_token
    config.fixedEscrow.toString(), // fixed_escrow
    price.toString(),              // strike_price (current BTC/USD)
    expo,                          // strike_price_expo
    config.commitDuration,         // commit_duration
    config.closedDuration,         // closed_duration
    config.revealDuration,         // reveal_duration
    config.accountAddress,         // fee_collector (keeper = owner = fee_collector)
  ]);

  return { txHash: result.transaction_hash, marketId: nextId };
}
