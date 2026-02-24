/**
 * DarkPool Keeper Service
 *
 * Manages the market lifecycle:
 * 1. Auto-create new markets every 5 minutes via factory contract
 * 2. Monitor market phase
 * 3. Resolve markets with Pyth BTC/USD price after expiry
 * 4. Finalize markets after reveal deadline
 *
 * Required env vars:
 *   STARKNET_RPC_URL - Starknet RPC endpoint
 *   KEEPER_PRIVATE_KEY - Private key for keeper account
 *   KEEPER_ADDRESS - Account address
 *   DARKPOOL_ADDRESS - DarkPool contract address (legacy single market)
 *   FACTORY_ADDRESS - DarkPoolFactory contract address
 */

import { config } from "./config.js";
import { getMarketInfo, resolveMarket, finalizeMarket, provider } from "./services/starknet.js";
import { fetchBtcPrice } from "./services/pyth.js";
import { createMarket, getMarketCount } from "./services/factory.js";

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

// ─── Auto-create loop ──────────────────────────────────────────────────

/** Milliseconds until the next clean 5-minute boundary. */
function msUntilNext5Min(): number {
  const now = Date.now();
  const intervalMs = config.createIntervalMs;
  const next = Math.ceil(now / intervalMs) * intervalMs;
  return next - now;
}

async function autoCreateMarket() {
  try {
    log("Auto-create: deploying new market via factory...");
    const { txHash, marketId } = await createMarket();
    log(`Auto-create tx: ${txHash} (market #${marketId})`);

    await provider.waitForTransaction(txHash);
    log(`Market #${marketId} created!`);
  } catch (err) {
    logError("Auto-create error:", err);
  }
}

function scheduleAutoCreate() {
  const delay = msUntilNext5Min();
  log(`Next market creation in ${Math.round(delay / 1000)}s`);

  setTimeout(async () => {
    await autoCreateMarket();
    // After first aligned tick, repeat on fixed interval
    setInterval(autoCreateMarket, config.createIntervalMs);
  }, delay);
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  log("DarkPool Keeper starting...");
  log(`RPC: ${config.rpcUrl}`);
  log(`Contract: ${config.darkpoolAddress}`);
  log(`Factory: ${config.factoryAddress}`);
  log(`Poll interval: ${config.pollIntervalMs}ms`);
  log(`Create interval: ${config.createIntervalMs}ms`);

  if (!config.privateKey || !config.accountAddress) {
    log("ERROR: Missing required env vars (KEEPER_PRIVATE_KEY, KEEPER_ADDRESS)");
    log("Set these in your environment or .env file and restart.");
    process.exit(1);
  }

  // Start resolve/finalize polling for existing market
  if (config.darkpoolAddress) {
    await checkAndResolve();
    setInterval(checkAndResolve, config.pollIntervalMs);
  }

  // Start auto-create loop if factory is configured
  if (config.factoryAddress) {
    const count = await getMarketCount();
    log(`Factory has ${count} markets`);
    scheduleAutoCreate();
  } else {
    log("No FACTORY_ADDRESS set — skipping auto-create");
  }

  log("Keeper running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
