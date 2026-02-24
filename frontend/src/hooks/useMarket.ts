import { useState, useEffect, useCallback } from "react";
import { getDarkPoolContract, parseMarketInfo, type MarketInfo } from "../lib/starknet";
import { DARKPOOL_ADDRESS } from "../lib/constants";

export function useMarket(pollInterval = 5000) {
  const [market, setMarket] = useState<MarketInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMarket = useCallback(async () => {
    if (!DARKPOOL_ADDRESS) {
      setLoading(false);
      return;
    }
    try {
      const contract = getDarkPoolContract();
      const raw = await contract.get_market_info();
      setMarket(parseMarketInfo(raw));
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to fetch market");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMarket();
    const id = setInterval(fetchMarket, pollInterval);
    return () => clearInterval(id);
  }, [fetchMarket, pollInterval]);

  return { market, loading, error, refetch: fetchMarket };
}
