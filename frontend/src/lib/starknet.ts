import { Contract, RpcProvider, type Abi } from "starknet";
import darkpoolAbi from "./abi.json";
import { DARKPOOL_ADDRESS } from "./constants";

export const provider = new RpcProvider({
  nodeUrl: import.meta.env.VITE_STARKNET_RPC || "https://starknet-sepolia.public.blastapi.io",
});

export function getDarkPoolContract(): Contract {
  return new Contract({
    abi: darkpoolAbi as Abi,
    address: DARKPOOL_ADDRESS,
    providerOrAccount: provider,
  });
}

export type Phase = "Committing" | "Closed" | "Resolved" | "Revealing" | "Finalized" | "Cancelled";
export type Side = "Up" | "Down" | "None";

export interface MarketInfo {
  market_id: bigint;
  phase: Phase;
  strike_price: bigint;
  strike_price_expo: number;
  resolution_price: bigint;
  outcome: Side;
  start_time: bigint;
  commit_deadline: bigint;
  expiry_time: bigint;
  reveal_deadline: bigint;
  fixed_escrow: bigint;
  commit_count: number;
  reveal_count: number;
  up_pool: bigint;
  down_pool: bigint;
  total_forfeited: bigint;
}

function parsePhase(raw: any): Phase {
  if (raw?.variant) {
    const key = Object.keys(raw.variant)[0];
    return key as Phase;
  }
  if (typeof raw === "object" && raw.activeVariant) {
    return raw.activeVariant() as Phase;
  }
  // Handle enum as string
  if (typeof raw === "string") return raw as Phase;
  return "Committing";
}

function parseSide(raw: any): Side {
  if (raw?.variant) {
    const key = Object.keys(raw.variant)[0];
    return key as Side;
  }
  if (typeof raw === "object" && raw.activeVariant) {
    return raw.activeVariant() as Side;
  }
  if (typeof raw === "string") return raw as Side;
  return "None";
}

export function parseMarketInfo(raw: any): MarketInfo {
  return {
    market_id: BigInt(raw.market_id || 0),
    phase: parsePhase(raw.phase),
    strike_price: BigInt(raw.strike_price || 0),
    strike_price_expo: Number(raw.strike_price_expo || 0),
    resolution_price: BigInt(raw.resolution_price || 0),
    outcome: parseSide(raw.outcome),
    start_time: BigInt(raw.start_time || 0),
    commit_deadline: BigInt(raw.commit_deadline || 0),
    expiry_time: BigInt(raw.expiry_time || 0),
    reveal_deadline: BigInt(raw.reveal_deadline || 0),
    fixed_escrow: BigInt(raw.fixed_escrow || 0),
    commit_count: Number(raw.commit_count || 0),
    reveal_count: Number(raw.reveal_count || 0),
    up_pool: BigInt(raw.up_pool || 0),
    down_pool: BigInt(raw.down_pool || 0),
    total_forfeited: BigInt(raw.total_forfeited || 0),
  };
}

export function formatStrk(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 2);
  return `${whole}.${fracStr}`;
}

export function parseStrk(display: string): bigint {
  const parts = display.split(".");
  const whole = BigInt(parts[0] || "0");
  const fracStr = (parts[1] || "0").padEnd(18, "0").slice(0, 18);
  return whole * 10n ** 18n + BigInt(fracStr);
}

export function formatPrice(price: bigint, expo: number): string {
  const absExpo = Math.abs(expo);
  const divisor = 10n ** BigInt(absExpo);
  const whole = price / divisor;
  const frac = (price % divisor).toString().padStart(absExpo, "0");
  return `$${whole.toLocaleString()}.${frac.slice(0, 2)}`;
}
