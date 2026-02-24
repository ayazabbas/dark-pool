import { useCallback } from "react";
import { Toaster } from "sonner";
import { ConnectButton } from "./components/ConnectButton";
import { PriceTicker } from "./components/PriceTicker";
import { MarketCard } from "./components/MarketCard";
import { BetPanel } from "./components/BetPanel";
import { RevealPanel } from "./components/RevealPanel";
import { ClaimPanel } from "./components/ClaimPanel";
import { MyBets } from "./components/MyBets";
import { HowItWorks } from "./components/HowItWorks";
import { useMarket } from "./hooks/useMarket";
import { DARKPOOL_ADDRESS } from "./lib/constants";
import { Card, CardContent } from "./components/ui/card";
import { AlertTriangle, Loader2, Zap } from "lucide-react";

function App() {
  const { market, loading, error, refetch } = useMarket();

  const handleAction = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <div className="min-h-screen bg-background">
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
          },
        }}
      />

      {/* Nav */}
      <nav className="border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <h1 className="text-lg font-bold tracking-tight flex items-center gap-1.5">
              <Zap size={18} className="text-accent" />
              <span className="text-accent">Dark</span>
              <span className="text-text-primary">Pool</span>
            </h1>
            <div className="h-4 w-px bg-border" />
            <PriceTicker />
          </div>
          <ConnectButton />
        </div>
      </nav>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-5">
        {!DARKPOOL_ADDRESS && (
          <Card className="border-yellow/20">
            <CardContent className="py-6 text-center">
              <AlertTriangle size={20} className="mx-auto mb-2 text-yellow" />
              <p className="text-yellow font-semibold text-sm mb-1">No Contract Address</p>
              <p className="text-xs text-text-secondary">
                Set <code className="bg-surface-light px-1.5 py-0.5 rounded text-text-primary font-mono">VITE_DARKPOOL_ADDRESS</code> in your{" "}
                <code className="bg-surface-light px-1.5 py-0.5 rounded text-text-primary font-mono">.env</code> file and restart.
              </p>
            </CardContent>
          </Card>
        )}

        {loading && (
          <div className="text-center py-16">
            <Loader2 size={24} className="mx-auto animate-spin text-accent mb-3" />
            <p className="text-sm text-text-secondary">Loading market data...</p>
          </div>
        )}

        {error && (
          <Card className="border-red/20">
            <CardContent className="py-6 text-center">
              <p className="text-red text-sm">{error}</p>
            </CardContent>
          </Card>
        )}

        {market && (
          <>
            <MarketCard market={market} />
            <BetPanel market={market} onBetPlaced={handleAction} />
            <RevealPanel market={market} onRevealed={handleAction} />
            <ClaimPanel market={market} onClaimed={handleAction} />
          </>
        )}

        <MyBets />
        <HowItWorks />

        {/* Footer */}
        <footer className="text-center py-8 border-t border-border">
          <p className="text-xs text-text-muted">
            DarkPool — Sealed prediction markets on Starknet
          </p>
          <p className="text-[11px] text-text-muted mt-1">
            Built for RE&#123;DEFINE&#125; Hackathon — Privacy Track
          </p>
        </footer>
      </main>
    </div>
  );
}

export default App;
