import { useState, useCallback } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { CallData } from "starknet";
import type { MarketInfo } from "../lib/starknet";
import { parseStrk } from "../lib/starknet";
import { computeCommitment, generateSalt } from "../lib/commitment";
import { saveBet } from "../lib/salts";
import { DARKPOOL_ADDRESS, STRK_ADDRESS, FIXED_ESCROW } from "../lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { ArrowUp, ArrowDown, Lock, Shield, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

interface BetPanelProps {
  market: MarketInfo;
  onBetPlaced: () => void;
}

export function BetPanel({ market, onBetPlaced }: BetPanelProps) {
  const { address } = useAccount();
  const { sendAsync } = useSendTransaction({});

  const [direction, setDirection] = useState<0 | 1 | null>(null);
  const [amount, setAmount] = useState("10");
  const [submitting, setSubmitting] = useState(false);
  const [sealed, setSealed] = useState(false);

  const handleCommit = useCallback(async () => {
    if (!address || direction === null) return;

    setSubmitting(true);

    try {
      const amountWei = parseStrk(amount);
      const salt = generateSalt();
      const commitmentHash = computeCommitment(direction, amountWei, salt, address);

      const calls = [
        {
          contractAddress: STRK_ADDRESS,
          entrypoint: "approve",
          calldata: CallData.compile({
            spender: DARKPOOL_ADDRESS,
            amount: { low: FIXED_ESCROW & ((1n << 128n) - 1n), high: FIXED_ESCROW >> 128n },
          }),
        },
        {
          contractAddress: DARKPOOL_ADDRESS,
          entrypoint: "commit",
          calldata: CallData.compile({
            commitment_hash: commitmentHash,
          }),
        },
      ];

      const result = await sendAsync(calls);

      saveBet(address, {
        marketAddress: DARKPOOL_ADDRESS,
        direction,
        amount: amountWei.toString(),
        salt,
        commitmentHash,
        commitTx: result.transaction_hash,
        status: "committed",
        timestamp: Date.now(),
      });

      setSealed(true);

      toast.success("Bet sealed!", {
        description: `${direction === 1 ? "UP" : "DOWN"} — ${amount} STRK sealed with Poseidon hash`,
        action: {
          label: "View tx",
          onClick: () => window.open(`https://sepolia.starkscan.co/tx/${result.transaction_hash}`, "_blank"),
        },
      });

      onBetPlaced();
    } catch (err: any) {
      const msg = err.message || "Unknown error";
      if (msg.includes("User abort") || msg.includes("rejected")) {
        toast.error("Transaction rejected", { description: "You declined the transaction in your wallet." });
      } else if (msg.includes("insufficient")) {
        toast.error("Insufficient balance", { description: "You need at least 10 STRK to place a bet." });
      } else {
        toast.error("Transaction failed", { description: msg.slice(0, 120) });
      }
    } finally {
      setSubmitting(false);
    }
  }, [address, direction, amount, sendAsync, onBetPlaced]);

  if (market.phase !== "Committing") return null;

  if (!address) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Shield size={24} className="mx-auto mb-3 text-text-muted" />
          <p className="text-text-secondary text-sm">Connect your wallet to place a sealed bet</p>
        </CardContent>
      </Card>
    );
  }

  if (sealed) {
    return (
      <Card className="border-accent/20 overflow-hidden">
        <div className="h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
        <CardContent className="py-8 text-center space-y-3">
          <div className="mx-auto w-12 h-12 rounded-full bg-accent-dim flex items-center justify-center">
            <ShieldCheck size={24} className="text-accent" />
          </div>
          <div>
            <p className="font-bold text-accent text-lg">Your bet is sealed</p>
            <p className="text-sm text-text-secondary mt-1">
              Position and amount are hidden on-chain. Nobody can see your bet until reveal phase.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-text-muted">
            <Lock size={12} />
            Secured with Poseidon hash commitment
          </div>
        </CardContent>
      </Card>
    );
  }

  const escrowDisplay = (Number(FIXED_ESCROW) / 1e18).toString();

  return (
    <Card className="overflow-hidden">
      <div className="h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock size={18} className="text-accent" />
          Seal Your Bet
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Direction buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setDirection(1)}
            className={`relative flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-lg transition-all cursor-pointer border ${
              direction === 1
                ? "bg-green/15 text-green border-green/40 shadow-[0_0_20px_rgba(34,197,94,0.1)]"
                : "bg-surface-light text-text-secondary border-border hover:border-green/30 hover:text-green"
            }`}
          >
            <ArrowUp size={22} />
            UP
            {direction === 1 && (
              <div className="absolute top-2 right-2">
                <div className="h-2 w-2 rounded-full bg-green animate-pulse" />
              </div>
            )}
          </button>
          <button
            onClick={() => setDirection(0)}
            className={`relative flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-lg transition-all cursor-pointer border ${
              direction === 0
                ? "bg-red/15 text-red border-red/40 shadow-[0_0_20px_rgba(239,68,68,0.1)]"
                : "bg-surface-light text-text-secondary border-border hover:border-red/30 hover:text-red"
            }`}
          >
            <ArrowDown size={22} />
            DOWN
            {direction === 0 && (
              <div className="absolute top-2 right-2">
                <div className="h-2 w-2 rounded-full bg-red animate-pulse" />
              </div>
            )}
          </button>
        </div>

        {/* Amount input */}
        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
            Bet Amount (STRK)
          </label>
          <div className="flex gap-2">
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0.001"
              max={escrowDisplay}
              step="0.1"
            />
            <div className="flex gap-1">
              {["1", "5", "10"].map((v) => (
                <Button
                  key={v}
                  variant={amount === v ? "default" : "secondary"}
                  size="sm"
                  onClick={() => setAmount(v)}
                  className="font-mono w-10"
                >
                  {v}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="text-xs text-text-secondary bg-surface-light/50 rounded-lg p-3 border border-border space-y-1">
          <div className="flex justify-between">
            <span>Escrow deposit</span>
            <span className="text-text-primary font-mono">{escrowDisplay} STRK</span>
          </div>
          <div className="flex justify-between">
            <span>Your actual bet</span>
            <span className="text-text-primary font-mono">{amount} STRK</span>
          </div>
          <div className="pt-1 border-t border-border mt-1">
            <p className="text-text-muted flex items-start gap-1.5">
              <Lock size={10} className="shrink-0 mt-0.5" />
              Everyone deposits the same escrow. Your direction and amount are hidden on-chain until reveal.
            </p>
          </div>
        </div>

        {/* Submit */}
        <Button
          onClick={handleCommit}
          disabled={direction === null || submitting || !amount}
          size="xl"
          className="w-full"
        >
          {submitting ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Sealing...
            </>
          ) : (
            <>
              <Lock size={18} />
              Seal Bet
              {direction !== null && (
                <Badge variant={direction === 1 ? "success" : "destructive"} className="ml-1">
                  {amount} STRK {direction === 1 ? "UP" : "DOWN"}
                </Badge>
              )}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
