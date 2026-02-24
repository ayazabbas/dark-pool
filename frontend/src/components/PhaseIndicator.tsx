import type { Phase } from "../lib/starknet";
import { Badge } from "./ui/badge";

const PHASES: Phase[] = ["Committing", "Closed", "Revealing", "Finalized"];

const PHASE_LABELS: Record<string, string> = {
  Committing: "COMMIT",
  Closed: "CLOSED",
  Revealing: "REVEAL",
  Finalized: "DONE",
  Resolved: "RESOLVED",
  Cancelled: "CANCELLED",
};

export function PhaseIndicator({ phase }: { phase: Phase }) {
  if (phase === "Cancelled") {
    return <Badge variant="destructive">CANCELLED</Badge>;
  }

  const activeIndex = PHASES.indexOf(phase);

  return (
    <div className="flex items-center gap-1">
      {PHASES.map((p, i) => {
        const isActive = p === phase;
        const isPast = i < activeIndex;
        return (
          <div key={p} className="flex items-center">
            <div
              className={`px-2 py-0.5 text-[10px] rounded-full font-semibold tracking-wider transition-all ${
                isActive
                  ? "bg-accent text-white shadow-[0_0_10px_rgba(99,102,241,0.3)]"
                  : isPast
                    ? "bg-accent-dim text-accent"
                    : "bg-surface-light text-text-muted"
              }`}
            >
              {PHASE_LABELS[p]}
            </div>
            {i < PHASES.length - 1 && (
              <div
                className={`w-3 h-px mx-0.5 ${
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
