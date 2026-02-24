export const config = {
  // Starknet RPC
  rpcUrl: process.env.STARKNET_RPC_URL || "https://starknet-sepolia.public.blastapi.io",

  // Keeper wallet
  privateKey: process.env.KEEPER_PRIVATE_KEY || "",
  accountAddress: process.env.KEEPER_ADDRESS || "",

  // Contracts
  darkpoolAddress: process.env.DARKPOOL_ADDRESS || "",
  factoryAddress: process.env.FACTORY_ADDRESS || "",
  strkAddress: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",

  // Market config
  fixedEscrow: BigInt(process.env.FIXED_ESCROW || "10000000000000000000"), // 10 STRK
  commitDuration: Number(process.env.COMMIT_DURATION || 150), // 2.5 min
  closedDuration: Number(process.env.CLOSED_DURATION || 150), // 2.5 min
  revealDuration: Number(process.env.REVEAL_DURATION || 300), // 5 min

  // Pyth
  hermesUrl: process.env.PYTH_HERMES_URL || "https://hermes.pyth.network",
  btcUsdFeedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",

  // Polling
  createIntervalMs: Number(process.env.CREATE_INTERVAL_MS || 300_000), // 5 min
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 30_000), // 30s
};
