import { useAccount } from "@starknet-react/core";
import { useMyBets } from "../hooks/useMyBets";
import { downloadBetsFile, importBets } from "../lib/salts";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Lock, Eye, Trophy, AlertTriangle, Download, Upload, ShieldAlert, Copy, Check } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

export function MyBets() {
  const { address } = useAccount();
  const { bets, refresh } = useMyBets(address);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copiedSalt, setCopiedSalt] = useState<string | null>(null);

  if (!address) return null;

  const statusConfig: Record<string, { icon: React.ReactNode; variant: "default" | "warning" | "success" | "destructive" }> = {
    committed: { icon: <Lock size={12} />, variant: "default" },
    revealed: { icon: <Eye size={12} />, variant: "warning" },
    claimed: { icon: <Trophy size={12} />, variant: "success" },
    forfeited: { icon: <AlertTriangle size={12} />, variant: "destructive" },
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !address) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const count = importBets(address, ev.target?.result as string);
        toast.success(`Imported ${count} bet${count !== 1 ? "s" : ""}`);
        refresh();
      } catch {
        toast.error("Invalid backup file", { description: "Make sure you're importing a valid DarkPool backup JSON." });
      }
    };
    reader.readAsText(file);
    // Reset so same file can be re-selected
    e.target.value = "";
  };

  const handleCopySalt = (salt: string) => {
    navigator.clipboard.writeText(salt);
    setCopiedSalt(salt);
    toast.success("Salt copied to clipboard");
    setTimeout(() => setCopiedSalt(null), 2000);
  };

  const hasUnrevealedBets = bets.some((b) => b.status === "committed");

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          My Bets
          {bets.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">{bets.length}</Badge>
          )}
        </CardTitle>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              downloadBetsFile(address);
              toast.success("Backup downloaded", { description: "Keep this file safe — it contains your bet salts." });
            }}
            className="gap-1.5"
            disabled={bets.length === 0}
          >
            <Download size={12} /> Backup
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="gap-1.5"
          >
            <Upload size={12} /> Import
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {/* Critical warning for unrevealed bets */}
        {hasUnrevealedBets && (
          <div className="mb-3 p-3 bg-yellow-dim border border-yellow/20 rounded-lg flex items-start gap-2.5">
            <ShieldAlert size={16} className="text-yellow shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs text-yellow font-semibold">Don't clear browser data!</p>
              <p className="text-[11px] text-yellow/80">
                You have unrevealed bets. Clearing browser data will lose your salts and forfeit your escrow.
                Use the Backup button to save a copy.
              </p>
            </div>
          </div>
        )}

        {/* Salt backup education (shown when user has bets but none unrevealed) */}
        {bets.length > 0 && !hasUnrevealedBets && (
          <div className="mb-3 p-2.5 bg-accent-dim/50 border border-accent/10 rounded-lg flex items-center gap-2 text-[11px] text-text-secondary">
            <Lock size={12} className="text-accent shrink-0" />
            Your bet salts are stored in this browser. Download a backup for safekeeping.
          </div>
        )}

        {bets.length === 0 && (
          <div className="py-6 text-center">
            <Lock size={20} className="mx-auto mb-2 text-text-muted" />
            <p className="text-sm text-text-muted">No bets yet</p>
            <p className="text-xs text-text-muted mt-1">Place a sealed bet to get started</p>
          </div>
        )}

        {bets
          .sort((a, b) => b.timestamp - a.timestamp)
          .map((bet, i) => {
            const cfg = statusConfig[bet.status] || statusConfig.committed;
            return (
              <div
                key={i}
                className="p-3 bg-surface-light rounded-lg border border-border hover:border-border-light transition-colors space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded-md ${
                      bet.direction === 1 ? "bg-green-dim" : "bg-red-dim"
                    }`}>
                      {bet.direction === 1 ? (
                        <span className="text-green text-xs font-bold">UP</span>
                      ) : (
                        <span className="text-red text-xs font-bold">DN</span>
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-mono font-medium">
                        {(Number(bet.amount) / 1e18).toFixed(2)} STRK
                      </div>
                      <div className="text-[11px] text-text-muted">
                        {new Date(bet.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <Badge variant={cfg.variant} className="gap-1">
                    {cfg.icon} {bet.status}
                  </Badge>
                </div>

                {/* Salt display for committed bets */}
                {bet.status === "committed" && (
                  <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                    <span className="text-[10px] text-text-muted uppercase tracking-wider">Salt:</span>
                    <code className="text-[10px] font-mono text-text-secondary truncate flex-1">
                      {bet.salt.slice(0, 12)}...{bet.salt.slice(-8)}
                    </code>
                    <button
                      onClick={() => handleCopySalt(bet.salt)}
                      className="text-text-muted hover:text-accent transition-colors p-0.5"
                    >
                      {copiedSalt === bet.salt ? (
                        <Check size={12} className="text-green" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
      </CardContent>
    </Card>
  );
}
