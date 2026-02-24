/**
 * DarkPool Keeper Service
 *
 * Manages the market lifecycle:
 * 1. Monitor market phase
 * 2. Resolve markets with Pyth BTC/USD price after expiry
 * 3. Finalize markets after reveal deadline
 *
 * Note: Market creation is done via deploy script (single-contract MVP).
 * The keeper focuses on resolution and finalization of existing markets.
 *
 * Required env vars:
 *   STARKNET_RPC_URL - Starknet RPC endpoint
 *   KEEPER_PRIVATE_KEY - Private key for keeper account
 *   KEEPER_ADDRESS - Account address
 *   DARKPOOL_ADDRESS - DarkPool contract address
 */

import { config } from "./config.js";
import { getMarketInfo, resolveMarket, finalizeMarket, provider } from "./services/starknet.js";
import { fetchBtcPrice } from "./services/pyth.js";

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logError(msg: string, err: unknown) {
  console.error(
    `[${new Date().toISOString()}] ${msg}`,
    err instanceof Error ? err.message : err
  );
}

async function checkAndResolve() {
  try {
    const info = await getMarketInfo();
    const now = Math.floor(Date.now() / 1000);

    log(
      `Phase: ${info.phase} | Commits: ${info.commit_count} | Reveals: ${info.reveal_count}`
    );

    // Resolve if in Closed phase and past expiry
    if (info.phase === "Closed" && now >= Number(info.expiry_time)) {
      if (info.commit_count === 0) {
        log("No commits — skipping resolution");
        return;
      }

      log("Market expired. Fetching BTC/USD price from Pyth...");
      const { price, expo } = await fetchBtcPrice();
      log(
        `Pyth price: ${price} (expo: ${expo}) | Strike: ${info.strike_price} (expo: ${info.strike_price_expo})`
      );

      log("Resolving market...");
      const txHash = await resolveMarket(price, expo);
      log(`Resolve tx: ${txHash}`);

      // Wait for confirmation
      await provider.waitForTransaction(txHash);
      log("Market resolved!");
    }

    // Finalize if in Resolved/Revealing phase and past reveal deadline
    if (
      (info.phase === "Resolved" || info.phase === "Revealing") &&
      now >= Number(info.reveal_deadline)
    ) {
      log("Reveal deadline passed. Finalizing market...");
      const txHash = await finalizeMarket();
      log(`Finalize tx: ${txHash}`);

      await provider.waitForTransaction(txHash);
      log("Market finalized!");
    }
  } catch (err) {
    logError("Error in check cycle:", err);
  }
}

async function main() {
  log("DarkPool Keeper starting...");
  log(`RPC: ${config.rpcUrl}`);
  log(`Contract: ${config.darkpoolAddress}`);
  log(`Poll interval: ${config.pollIntervalMs}ms`);

  if (!config.privateKey || !config.accountAddress || !config.darkpoolAddress) {
    log("ERROR: Missing required env vars (KEEPER_PRIVATE_KEY, KEEPER_ADDRESS, DARKPOOL_ADDRESS)");
    log("Set these in your environment or .env file and restart.");
    process.exit(1);
  }

  // Initial check
  await checkAndResolve();

  // Poll loop
  setInterval(checkAndResolve, config.pollIntervalMs);

  log("Keeper running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
