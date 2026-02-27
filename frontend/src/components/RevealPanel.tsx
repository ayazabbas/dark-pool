import { useState, useCallback, useEffect } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { CallData } from "starknet";
import type { MarketInfo } from "../lib/starknet";
import { getBetForMarket, updateBetStatus } from "../lib/salts";
import { DARKPOOL_ADDRESS } from "../lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Eye, CheckCircle, Loader2, AlertTriangle, Lock } from "lucide-react";
import { toast } from "sonner";

interface RevealPanelProps {
  market: MarketInfo;
  onRevealed: () => void;
}

export function RevealPanel({ market, onRevealed }: RevealPanelProps) {
  const { address } = useAccount();
  const { sendAsync } = useSendTransaction({});

  const [submitting, setSubmitting] = useState(false);
  const [autoRevealed, setAutoRevealed] = useState(false);

  const bet = address ? getBetForMarket(address, DARKPOOL_ADDRESS) : undefined;

  const handleReveal = useCallback(async () => {
    if (!address || !bet) return;

    setSubmitting(true);

    try {
      const amountBigInt = BigInt(bet.amount);
      const calls = [
        {
          contractAddress: DARKPOOL_ADDRESS,
          entrypoint: "reveal",
          calldata: CallData.compile({
            direction: bet.direction,
            amount: { low: amountBigInt & ((1n << 128n) - 1n), high: amountBigInt >> 128n },
            salt: bet.salt,
          }),
        },
      ];

      const result = await sendAsync(calls);

      updateBetStatus(address, DARKPOOL_ADDRESS, bet.salt, {
        status: "revealed",
        revealTx: result.transaction_hash,
      });

      toast.success("Bet revealed!", {
        description: `${bet.direction === 1 ? "UP" : "DOWN"} — ${(Number(bet.amount) / 1e18).toFixed(2)} STRK`,
        action: {
          label: "View tx",
          onClick: () => window.open(`https://sepolia.starkscan.co/tx/${result.transaction_hash}`, "_blank"),
        },
      });

      onRevealed();
    } catch (err: any) {
      const msg = err.message || "Unknown error";
      if (msg.includes("User abort") || msg.includes("rejected")) {
        toast.error("Transaction rejected", { description: "You declined the reveal in your wallet." });
      } else {
        toast.error("Reveal failed", { description: msg.slice(0, 120) });
      }
    } finally {
      setSubmitting(false);
    }
  }, [address, bet, sendAsync, onRevealed]);

  // Auto-reveal
  useEffect(() => {
    if (
      market.phase === "Revealing" &&
      bet &&
      bet.status === "committed" &&
      !autoRevealed &&
      !submitting
    ) {
      setAutoRevealed(true);
      handleReveal();
    }
  }, [market.phase, bet, autoRevealed, submitting, handleReveal]);

  if (market.phase !== "Revealing") return null;
  if (!address) return null;

  // Salt missing — user committed but we lost the data
  if (!bet) {
    return (
      <Card className="border-red/20">
        <div className="h-px bg-gradient-to-r from-transparent via-red/50 to-transparent" />
        <CardContent className="py-6">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-red shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red">Salt data missing</p>
              <p className="text-sm text-text-secondary mt-1">
                Your bet data was not found in this browser. Import your backup from the My Bets section to reveal.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (bet.status === "revealed") {
    return (
      <Card className="border-green/20">
        <div className="h-px bg-gradient-to-r from-transparent via-green/50 to-transparent" />
        <CardContent className="py-6">
          <div className="flex items-center gap-3">
            <CheckCircle size={20} className="text-green" />
            <div>
              <p className="font-semibold text-green">Bet Revealed</p>
              <p className="text-sm text-text-secondary mt-0.5">
                {bet.direction === 1 ? "UP" : "DOWN"} — {(Number(bet.amount) / 1e18).toFixed(2)} STRK
              </p>
            </div>
            {bet.revealTx && (
              <a
                href={`https://sepolia.starkscan.co/tx/${bet.revealTx}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-xs text-accent hover:underline"
              >
                View tx
              </a>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-yellow/20">
      <div className="h-px bg-gradient-to-r from-transparent via-yellow/50 to-transparent" />
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-yellow">
          <Eye size={18} />
          Reveal Your Bet
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          Your sealed bet:
          <Badge variant={bet.direction === 1 ? "success" : "destructive"}>
            {bet.direction === 1 ? "UP" : "DOWN"}
          </Badge>
          <span className="font-mono">{(Number(bet.amount) / 1e18).toFixed(2)} STRK</span>
        </div>

        <div className="flex items-start gap-2 text-xs text-text-muted bg-surface-light/50 rounded-lg p-2.5 border border-border">
          <Lock size={12} className="shrink-0 mt-0.5" />
          Your Poseidon commitment will be verified on-chain. Excess escrow is refunded immediately.
        </div>

        <div className="flex items-start gap-2 text-xs text-red bg-red-dim rounded-lg p-2.5 border border-red/10">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          If you don't reveal before the deadline, your escrow will be forfeited.
        </div>

        <Button
          onClick={handleReveal}
          disabled={submitting}
          variant="warning"
          size="lg"
          className="w-full"
        >
          {submitting ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Revealing...
            </>
          ) : (
            <>
              <Eye size={18} />
              Reveal Now
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
