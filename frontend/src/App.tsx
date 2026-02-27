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
import { AlertTriangle, Loader2, Zap, RefreshCw } from "lucide-react";
import { Button } from "./components/ui/button";

function MarketSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="h-px bg-gradient-to-r from-transparent via-accent/20 to-transparent" />
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="skeleton h-6 w-32" />
          <div className="skeleton h-5 w-48" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="skeleton h-3 w-16" />
              <div className="skeleton h-5 w-24" />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

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
        <div className="max-w-4xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3 sm:gap-5">
            <h1 className="text-lg font-bold tracking-tight flex items-center gap-1.5">
              <Zap size={18} className="text-accent" />
              <span className="text-accent">Dark</span>
              <span className="text-text-primary">Pool</span>
            </h1>
            <div className="h-4 w-px bg-border hidden sm:block" />
            <div className="hidden sm:block">
              <PriceTicker />
            </div>
          </div>
          <ConnectButton />
        </div>
      </nav>

      {/* Mobile price ticker — below nav on small screens */}
      <div className="sm:hidden border-b border-border bg-surface/60 px-3 py-2 flex items-center justify-center">
        <PriceTicker />
      </div>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-3 sm:px-4 py-5 sm:py-8 space-y-4 sm:space-y-5">
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

        {loading && <MarketSkeleton />}

        {error && (
          <Card className="border-red/20">
            <CardContent className="py-6 text-center space-y-3">
              <AlertTriangle size={20} className="mx-auto text-red" />
              <p className="text-red text-sm">{error}</p>
              <Button variant="secondary" size="sm" onClick={refetch} className="gap-1.5">
                <RefreshCw size={14} />
                Retry
              </Button>
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
        <footer className="text-center py-6 sm:py-8 border-t border-border">
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
