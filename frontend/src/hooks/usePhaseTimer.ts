import { useState, useEffect } from "react";
import type { MarketInfo } from "../lib/starknet";

export function usePhaseTimer(market: MarketInfo | null) {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    if (!market) return;

    const getDeadline = (): number => {
      const now = Math.floor(Date.now() / 1000);
      switch (market.phase) {
        case "Committing":
          return Number(market.commit_deadline) - now;
        case "Closed":
          return Number(market.expiry_time) - now;
        case "Revealing":
          return Number(market.reveal_deadline) - now;
        default:
          return 0;
      }
    };

    setTimeLeft(Math.max(0, getDeadline()));

    const id = setInterval(() => {
      setTimeLeft(Math.max(0, getDeadline()));
    }, 1000);

    return () => clearInterval(id);
  }, [market]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const formatted = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  return { timeLeft, formatted };
}
