import {
  Account,
  RpcProvider,
  Contract,
  json,
  CallData,
  type Abi,
} from "starknet";
import { config } from "../config.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load ABI
const sierraPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "contracts",
  "target",
  "dev",
  "darkpool_DarkPool.contract_class.json"
);

let darkpoolAbi: Abi;
try {
  const sierra = json.parse(fs.readFileSync(sierraPath, "utf-8"));
  darkpoolAbi = sierra.abi;
} catch {
  console.warn("Warning: Could not load ABI from contracts build output");
  darkpoolAbi = [];
}

export const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
export const account = new Account(
  provider,
  config.accountAddress,
  config.privateKey
);

export function getDarkPoolContract(): Contract {
  const contract = new Contract(darkpoolAbi, config.darkpoolAddress, provider);
  contract.connect(account);
  return contract;
}

export interface MarketInfo {
  phase: string;
  strike_price: bigint;
  strike_price_expo: number;
  commit_deadline: bigint;
  expiry_time: bigint;
  reveal_deadline: bigint;
  commit_count: number;
  reveal_count: number;
}

function parsePhase(raw: any): string {
  if (raw?.variant) {
    return Object.keys(raw.variant)[0];
  }
  if (typeof raw === "object" && raw.activeVariant) {
    return raw.activeVariant();
  }
  if (typeof raw === "string") return raw;
  return "Unknown";
}

export async function getMarketInfo(): Promise<MarketInfo> {
  const contract = getDarkPoolContract();
  const raw = await contract.get_market_info();
  return {
    phase: parsePhase(raw.phase),
    strike_price: BigInt(raw.strike_price || 0),
    strike_price_expo: Number(raw.strike_price_expo || 0),
    commit_deadline: BigInt(raw.commit_deadline || 0),
    expiry_time: BigInt(raw.expiry_time || 0),
    reveal_deadline: BigInt(raw.reveal_deadline || 0),
    commit_count: Number(raw.commit_count || 0),
    reveal_count: Number(raw.reveal_count || 0),
  };
}

export async function resolveMarket(price: bigint, expo: number): Promise<string> {
  const contract = getDarkPoolContract();
  const result = await contract.invoke("resolve", [price, expo]);
  return result.transaction_hash;
}

export async function finalizeMarket(): Promise<string> {
  const contract = getDarkPoolContract();
  const result = await contract.invoke("finalize", []);
  return result.transaction_hash;
}
