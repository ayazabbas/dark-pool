import { config } from "../config.js";

interface PythPrice {
  price: string;
  expo: number;
  conf: string;
  publish_time: number;
}

interface PythPriceUpdate {
  parsed: Array<{
    id: string;
    price: PythPrice;
    ema_price: PythPrice;
  }>;
}

/**
 * Fetch the latest BTC/USD price from Pyth Hermes API.
 */
export async function fetchBtcPrice(): Promise<{ price: bigint; expo: number }> {
  const feedId = config.btcUsdFeedId.replace("0x", "");
  const url = `${config.hermesUrl}/v2/updates/price/latest?ids[]=${feedId}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Pyth Hermes API error: ${res.status} ${res.statusText}`);
  }

  const data: PythPriceUpdate = await res.json();
  if (!data.parsed?.[0]?.price) {
    throw new Error("No price data from Pyth");
  }

  const p = data.parsed[0].price;
  return {
    price: BigInt(p.price),
    expo: p.expo,
  };
}
