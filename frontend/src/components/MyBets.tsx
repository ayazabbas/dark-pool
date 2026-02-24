import { useAccount } from "@starknet-react/core";
import { useMyBets } from "../hooks/useMyBets";
import { downloadBetsFile, importBets } from "../lib/salts";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Lock, Eye, Trophy, AlertTriangle, Download, Upload } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

export function MyBets() {
  const { address } = useAccount();
  const { bets, refresh } = useMyBets(address);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!address) return null;
  if (bets.length === 0) return null;

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
        toast.success(`Imported ${count} bets`);
        refresh();
      } catch {
        toast.error("Invalid backup file");
      }
    };
    reader.readAsText(file);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>My Bets</CardTitle>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadBetsFile(address)}
            className="gap-1"
          >
            <Download size={12} /> Backup
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="gap-1"
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
        {bets.some((b) => b.status === "committed") && (
          <div className="mb-3 p-2.5 bg-yellow-dim border border-yellow/20 rounded-lg text-xs text-yellow flex items-center gap-2">
            <AlertTriangle size={14} />
            Don't clear browser data while you have unrevealed bets!
          </div>
        )}

        {bets
          .sort((a, b) => b.timestamp - a.timestamp)
          .map((bet, i) => {
            const cfg = statusConfig[bet.status] || statusConfig.committed;
            return (
              <div
                key={i}
                className="flex items-center justify-between p-3 bg-surface-light rounded-lg border border-border hover:border-border-light transition-colors"
              >
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
            );
          })}
      </CardContent>
    </Card>
  );
}
