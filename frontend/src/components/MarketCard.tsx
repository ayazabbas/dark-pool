import type { MarketInfo } from "../lib/starknet";
import { formatPrice } from "../lib/starknet";
import { usePhaseTimer } from "../hooks/usePhaseTimer";
import { PhaseIndicator } from "./PhaseIndicator";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Badge } from "./ui/badge";
import { Lock, Clock, Users, TrendingUp, TrendingDown, Zap } from "lucide-react";

interface MarketCardProps {
  market: MarketInfo;
}

export function MarketCard({ market }: MarketCardProps) {
  const { formatted, timeLeft } = usePhaseTimer(market);

  const showTimer = ["Committing", "Closed", "Revealing"].includes(market.phase);
  const isUrgent = timeLeft > 0 && timeLeft < 30;

  return (
    <Card className="overflow-hidden">
      {/* Accent top border glow */}
      <div className="h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />

      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Zap size={18} className="text-accent" />
              <span className="text-lg font-bold tracking-tight">BTC/USD</span>
            </div>
            <Badge variant="secondary" className="font-mono text-[10px]">
              #{market.market_id.toString()}
            </Badge>
          </div>
          <PhaseIndicator phase={market.phase} />
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Strike Price */}
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
              Strike
            </div>
            <div className="text-base font-mono font-bold text-text-primary">
              {formatPrice(market.strike_price, market.strike_price_expo)}
            </div>
          </div>

          {/* Timer */}
          {showTimer && (
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-text-muted font-medium flex items-center gap-1">
                <Clock size={10} /> Time Left
              </div>
              <div
                className={`text-base font-mono font-bold ${
                  isUrgent ? "text-red animate-pulse" : "text-yellow"
                }`}
              >
                {formatted}
              </div>
            </div>
          )}

          {/* Sealed Bets */}
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-text-muted font-medium flex items-center gap-1">
              <Lock size={10} /> Sealed
            </div>
            <div className="text-base font-mono font-bold text-text-primary">
              {market.commit_count}
              <span className="text-text-muted text-xs ml-1">bets</span>
            </div>
          </div>

          {/* Reveals */}
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-text-muted font-medium flex items-center gap-1">
              <Users size={10} /> Revealed
            </div>
            <div className="text-base font-mono font-bold text-text-primary">
              {market.reveal_count}
              <span className="text-text-muted text-xs ml-1">/ {market.commit_count}</span>
            </div>
          </div>
        </div>

        {/* Finalized: show outcome + pools */}
        {market.phase === "Finalized" && (
          <div className="mt-5 pt-4 border-t border-border grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
                Outcome
              </div>
              <div className="flex items-center gap-1.5">
                {market.outcome === "Up" ? (
                  <TrendingUp size={16} className="text-green" />
                ) : (
                  <TrendingDown size={16} className="text-red" />
                )}
                <span
                  className={`text-base font-bold ${
                    market.outcome === "Up" ? "text-green" : "text-red"
                  }`}
                >
                  {market.outcome === "Up" ? "UP" : "DOWN"}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-text-muted font-medium flex items-center gap-1">
                <TrendingUp size={10} className="text-green" /> UP Pool
              </div>
              <div className="text-sm font-mono font-semibold">
                {(Number(market.up_pool) / 1e18).toFixed(2)}
                <span className="text-text-muted text-xs ml-1">STRK</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-text-muted font-medium flex items-center gap-1">
                <TrendingDown size={10} className="text-red" /> DOWN Pool
              </div>
              <div className="text-sm font-mono font-semibold">
                {(Number(market.down_pool) / 1e18).toFixed(2)}
                <span className="text-text-muted text-xs ml-1">STRK</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
