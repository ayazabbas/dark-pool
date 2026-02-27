import { useState, useCallback } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { CallData } from "starknet";
import type { MarketInfo } from "../lib/starknet";
import { getBetForMarket, updateBetStatus } from "../lib/salts";
import { DARKPOOL_ADDRESS } from "../lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Trophy, Ban, Frown, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ClaimPanelProps {
  market: MarketInfo;
  onClaimed: () => void;
}

export function ClaimPanel({ market, onClaimed }: ClaimPanelProps) {
  const { address } = useAccount();
  const { sendAsync } = useSendTransaction({});

  const [submitting, setSubmitting] = useState(false);

  const bet = address ? getBetForMarket(address, DARKPOOL_ADDRESS) : undefined;

  const isWinner =
    bet &&
    ((market.outcome === "Up" && bet.direction === 1) ||
     (market.outcome === "Down" && bet.direction === 0));

  const handleClaim = useCallback(async () => {
    if (!address || !bet) return;
    setSubmitting(true);

    try {
      const calls = [
        {
          contractAddress: DARKPOOL_ADDRESS,
          entrypoint: "claim",
          calldata: CallData.compile({}),
        },
      ];

      const result = await sendAsync(calls);
      updateBetStatus(address, DARKPOOL_ADDRESS, bet.salt, {
        status: "claimed",
        claimTx: result.transaction_hash,
      });

      toast.success("Payout claimed!", {
        action: {
          label: "View tx",
          onClick: () => window.open(`https://sepolia.starkscan.co/tx/${result.transaction_hash}`, "_blank"),
        },
      });
      onClaimed();
    } catch (err: any) {
      const msg = err.message || "Unknown error";
      if (msg.includes("already claimed") || msg.includes("has_claimed")) {
        toast.error("Already claimed", { description: "You've already claimed your payout for this market." });
      } else {
        toast.error("Claim failed", { description: msg.slice(0, 120) });
      }
    } finally {
      setSubmitting(false);
    }
  }, [address, bet, sendAsync, onClaimed]);

  const handleRefund = useCallback(async () => {
    if (!address || !bet) return;
    setSubmitting(true);

    try {
      const calls = [
        {
          contractAddress: DARKPOOL_ADDRESS,
          entrypoint: "refund",
          calldata: CallData.compile({}),
        },
      ];

      const result = await sendAsync(calls);
      updateBetStatus(address, DARKPOOL_ADDRESS, bet.salt, {
        status: "claimed",
        claimTx: result.transaction_hash,
      });

      toast.success("Refund claimed!", {
        action: {
          label: "View tx",
          onClick: () => window.open(`https://sepolia.starkscan.co/tx/${result.transaction_hash}`, "_blank"),
        },
      });
      onClaimed();
    } catch (err: any) {
      toast.error("Refund failed", { description: (err.message || "Unknown error").slice(0, 120) });
    } finally {
      setSubmitting(false);
    }
  }, [address, bet, sendAsync, onClaimed]);

  if (!address || !bet) return null;

  if (bet.status === "claimed") {
    return (
      <Card className="border-green/20">
        <div className="h-px bg-gradient-to-r from-transparent via-green/50 to-transparent" />
        <CardContent className="py-6 text-center">
          <CheckCircle size={28} className="mx-auto mb-2 text-green" />
          <p className="text-green font-bold">Payout claimed!</p>
          {bet.claimTx && (
            <a
              href={`https://sepolia.starkscan.co/tx/${bet.claimTx}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent hover:underline mt-1 block"
            >
              View transaction
            </a>
          )}
        </CardContent>
      </Card>
    );
  }

  if (market.phase === "Cancelled") {
    return (
      <Card className="border-yellow/20">
        <div className="h-px bg-gradient-to-r from-transparent via-yellow/50 to-transparent" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-yellow">
            <Ban size={18} />
            Market Cancelled
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-text-secondary">
            This market was cancelled. You can claim a refund of your escrow.
          </p>
          <Button
            onClick={handleRefund}
            disabled={submitting}
            variant="warning"
            size="lg"
            className="w-full"
          >
            {submitting ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Claiming refund...
              </>
            ) : (
              "Claim Refund"
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (market.phase !== "Finalized") return null;

  let estimatedPayout = "0";
  if (isWinner && bet.status === "revealed") {
    const up = market.up_pool;
    const down = market.down_pool;
    const winPool = market.outcome === "Up" ? up : down;
    const losePool = market.outcome === "Up" ? down : up;
    const fee = (losePool * 300n) / 10000n;
    const payoutPool = winPool + losePool - fee + market.total_forfeited;
    const userBet = BigInt(bet.amount);
    if (winPool > 0n) {
      const payout = (userBet * payoutPool) / winPool;
      estimatedPayout = (Number(payout) / 1e18).toFixed(2);
    }
  }

  return (
    <Card className={isWinner ? "border-green/20" : "border-red/20"}>
      <div className={`h-px bg-gradient-to-r from-transparent ${isWinner ? "via-green/50" : "via-red/30"} to-transparent`} />
      {isWinner ? (
        <>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green">
              <Trophy size={20} />
              You Won!
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-text-secondary">
              {bet.direction === 1 ? "UP" : "DOWN"} — {(Number(bet.amount) / 1e18).toFixed(2)} STRK
            </div>
            <div className="text-3xl font-bold font-mono text-green">
              ~{estimatedPayout} <span className="text-lg">STRK</span>
            </div>
            <Button
              onClick={handleClaim}
              disabled={submitting}
              variant="success"
              size="lg"
              className="w-full"
            >
              {submitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Claiming...
                </>
              ) : (
                <>
                  <Trophy size={18} />
                  Claim Payout
                </>
              )}
            </Button>
          </CardContent>
        </>
      ) : (
        <CardContent className="py-6">
          <div className="flex items-center gap-3">
            <Frown size={20} className="text-red" />
            <div>
              <p className="font-semibold text-text-primary">Better luck next time</p>
              <p className="text-sm text-text-secondary mt-0.5">
                Your bet ({bet.direction === 1 ? "UP" : "DOWN"}) didn't win this round.
              </p>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
