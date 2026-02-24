import { Card, CardContent } from "./ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import { Lock, Shield, Eye, Trophy } from "lucide-react";

export function HowItWorks() {
  return (
    <Card>
      <CardContent className="p-0">
        <Accordion type="single" collapsible>
          <AccordionItem value="how-it-works" className="border-none">
            <AccordionTrigger className="px-6 text-lg font-bold hover:no-underline">
              How It Works
            </AccordionTrigger>
            <AccordionContent className="px-6 space-y-5">
              <div className="flex gap-4">
                <div className="mt-0.5 p-2 rounded-lg bg-accent-dim">
                  <Lock className="text-accent" size={18} />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-text-primary">1. Seal Your Bet</h4>
                  <p className="text-sm text-text-secondary mt-1 leading-relaxed">
                    Choose UP or DOWN and your bet amount. Your bet is sealed using a
                    Poseidon hash — nobody can see your position or amount on-chain.
                    Everyone deposits the same escrow to prevent leaking bet sizes.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="mt-0.5 p-2 rounded-lg bg-yellow-dim">
                  <Shield className="text-yellow" size={18} />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-text-primary">2. Market Resolves</h4>
                  <p className="text-sm text-text-secondary mt-1 leading-relaxed">
                    After the commitment window closes, the oracle determines the
                    BTC/USD price. The outcome is set BEFORE anyone reveals
                    — no one can change their position after seeing the result.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="mt-0.5 p-2 rounded-lg bg-green-dim">
                  <Eye className="text-green" size={18} />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-text-primary">3. Reveal</h4>
                  <p className="text-sm text-text-secondary mt-1 leading-relaxed">
                    Prove your bet by submitting the original inputs. The contract
                    verifies your Poseidon hash matches. Excess escrow is immediately refunded.
                    If you don't reveal in time, your escrow is forfeited.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="mt-0.5 p-2 rounded-lg bg-green-dim">
                  <Trophy className="text-green" size={18} />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-text-primary">4. Claim Payout</h4>
                  <p className="text-sm text-text-secondary mt-1 leading-relaxed">
                    Winners split the losing pool proportionally (parimutuel).
                    A 3% fee is taken from the losing side only. Forfeited
                    escrows from non-revealers also go to the payout pool.
                  </p>
                </div>
              </div>

              <div className="p-4 bg-surface-light rounded-lg border border-border">
                <p className="font-semibold text-xs text-text-primary mb-2 uppercase tracking-wider">
                  Why sealed bets matter
                </p>
                <ul className="text-sm text-text-secondary space-y-1.5">
                  <li className="flex items-start gap-2">
                    <span className="text-accent mt-1">•</span>
                    No front-running — whales can't move odds before you bet
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-accent mt-1">•</span>
                    No herd behavior — you can't see what others are betting
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-accent mt-1">•</span>
                    No information leakage — your position is private until reveal
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-accent mt-1">•</span>
                    True price discovery from independent conviction
                  </li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
