// Contract address — update after deployment
export const DARKPOOL_ADDRESS = import.meta.env.VITE_DARKPOOL_ADDRESS || "";

// Starknet Sepolia addresses
export const STRK_ADDRESS = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

// Pyth
export const PYTH_HERMES_URL = "https://hermes.pyth.network";
export const BTC_USD_FEED_ID = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

// Market timing
export const COMMIT_DURATION = 150; // 2.5 min
export const CLOSED_DURATION = 150; // 2.5 min
export const REVEAL_DURATION = 300; // 5 min

// Escrow
export const FIXED_ESCROW = 10n * 10n ** 18n; // 10 STRK
export const FIXED_ESCROW_DISPLAY = "10";
export const MIN_BET = 10n ** 15n; // 0.001 STRK

// Phase names
export const PHASE_NAMES: Record<string, string> = {
  Committing: "Committing",
  Closed: "Closed",
  Resolved: "Resolved",
  Revealing: "Revealing",
  Finalized: "Finalized",
  Cancelled: "Cancelled",
};

// ERC20 ABI (minimal for approve + balanceOf)
export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "core::starknet::contract_address::ContractAddress" },
      { name: "amount", type: "core::integer::u256" },
    ],
    outputs: [{ type: "core::bool" }],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "balance_of",
    inputs: [
      { name: "account", type: "core::starknet::contract_address::ContractAddress" },
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
] as const;
