import { useState, useEffect } from "react";
import { PYTH_HERMES_URL, BTC_USD_FEED_ID } from "../lib/constants";

export function usePythPrice() {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchPrice() {
      try {
        const feedId = BTC_USD_FEED_ID.replace("0x", "");
        const res = await fetch(
          `${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}`
        );
        const data = await res.json();
        if (!cancelled && data.parsed?.[0]?.price) {
          const p = data.parsed[0].price;
          const priceVal = Number(p.price) * Math.pow(10, Number(p.expo));
          setPrice(priceVal);
        }
      } catch {
        // Silently fail — price ticker is non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPrice();
    const id = setInterval(fetchPrice, 10000); // Poll every 10s

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { price, loading };
}
