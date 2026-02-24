import { useState, useEffect, useCallback } from "react";
import { getBets, type StoredBet } from "../lib/salts";

export function useMyBets(walletAddress: string | undefined) {
  const [bets, setBets] = useState<StoredBet[]>([]);

  const refresh = useCallback(() => {
    if (!walletAddress) {
      setBets([]);
      return;
    }
    setBets(getBets(walletAddress));
  }, [walletAddress]);

  useEffect(() => {
    refresh();
    // Refresh on localStorage changes
    const handler = () => refresh();
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [refresh]);

  return { bets, refresh };
}
