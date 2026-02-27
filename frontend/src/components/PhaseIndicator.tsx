import type { Phase } from "../lib/starknet";
import { Badge } from "./ui/badge";
import { Lock, Clock, Eye, CheckCircle } from "lucide-react";

const PHASES: Phase[] = ["Committing", "Closed", "Revealing", "Finalized"];

const PHASE_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  Committing: { label: "SEAL", icon: <Lock size={9} /> },
  Closed: { label: "WAIT", icon: <Clock size={9} /> },
  Revealing: { label: "REVEAL", icon: <Eye size={9} /> },
  Finalized: { label: "DONE", icon: <CheckCircle size={9} /> },
};

export function PhaseIndicator({ phase }: { phase: Phase }) {
  if (phase === "Cancelled") {
    return <Badge variant="destructive">CANCELLED</Badge>;
  }

  const activeIndex = PHASES.indexOf(phase);

  return (
    <div className="flex items-center gap-0.5 sm:gap-1">
      {PHASES.map((p, i) => {
        const isActive = p === phase;
        const isPast = i < activeIndex;
        const cfg = PHASE_CONFIG[p];
        return (
          <div key={p} className="flex items-center">
            <div
              className={`flex items-center gap-1 px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] rounded-full font-semibold tracking-wider transition-all ${
                isActive
                  ? "bg-accent text-white shadow-[0_0_10px_rgba(99,102,241,0.3)]"
                  : isPast
                    ? "bg-accent-dim text-accent"
                    : "bg-surface-light text-text-muted"
              }`}
            >
              <span className="hidden sm:inline">{cfg.icon}</span>
              {cfg.label}
            </div>
            {i < PHASES.length - 1 && (
              <div
                className={`w-2 sm:w-3 h-px mx-0.5 ${
                  isPast ? "bg-accent/40" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
