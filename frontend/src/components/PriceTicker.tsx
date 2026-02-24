import { usePythPrice } from "../hooks/usePythPrice";
import { Activity } from "lucide-react";

export function PriceTicker() {
  const { price, loading } = usePythPrice();

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-text-secondary text-sm">
        <Activity size={14} className="animate-pulse" />
        <span className="font-mono">BTC/USD ---</span>
      </div>
    );
  }

  if (!price) {
    return (
      <div className="flex items-center gap-2 text-text-muted text-sm">
        <Activity size={14} />
        <span className="font-mono">BTC/USD --</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <Activity size={14} className="text-green" />
      <span className="font-mono text-text-secondary">BTC</span>
      <span className="font-mono font-semibold text-green tracking-wide">
        ${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}
