export interface StoredBet {
  marketAddress: string;
  direction: 0 | 1;
  amount: string; // wei string
  salt: string; // felt252 hex
  commitmentHash: string;
  commitTx?: string;
  revealTx?: string;
  claimTx?: string;
  status: "committed" | "revealed" | "claimed" | "forfeited";
  timestamp: number;
}

const STORAGE_KEY_PREFIX = "darkpool:bets:";

function getKey(walletAddress: string): string {
  return `${STORAGE_KEY_PREFIX}${walletAddress.toLowerCase()}`;
}

export function getBets(walletAddress: string): StoredBet[] {
  try {
    const raw = localStorage.getItem(getKey(walletAddress));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveBet(walletAddress: string, bet: StoredBet): void {
  const bets = getBets(walletAddress);
  const existing = bets.findIndex(
    (b) =>
      b.marketAddress === bet.marketAddress &&
      b.salt === bet.salt
  );
  if (existing >= 0) {
    bets[existing] = bet;
  } else {
    bets.push(bet);
  }
  localStorage.setItem(getKey(walletAddress), JSON.stringify(bets));
}

export function updateBetStatus(
  walletAddress: string,
  marketAddress: string,
  salt: string,
  updates: Partial<StoredBet>
): void {
  const bets = getBets(walletAddress);
  const idx = bets.findIndex(
    (b) => b.marketAddress === marketAddress && b.salt === salt
  );
  if (idx >= 0) {
    bets[idx] = { ...bets[idx], ...updates };
    localStorage.setItem(getKey(walletAddress), JSON.stringify(bets));
  }
}

export function getBetForMarket(
  walletAddress: string,
  marketAddress: string
): StoredBet | undefined {
  const bets = getBets(walletAddress);
  return bets.find((b) => b.marketAddress === marketAddress);
}

export function exportBets(walletAddress: string): string {
  const bets = getBets(walletAddress);
  return JSON.stringify(bets, null, 2);
}

export function importBets(walletAddress: string, json: string): number {
  const imported: StoredBet[] = JSON.parse(json);
  const existing = getBets(walletAddress);
  let count = 0;
  for (const bet of imported) {
    const exists = existing.some(
      (b) => b.marketAddress === bet.marketAddress && b.salt === bet.salt
    );
    if (!exists) {
      existing.push(bet);
      count++;
    }
  }
  localStorage.setItem(getKey(walletAddress), JSON.stringify(existing));
  return count;
}

export function downloadBetsFile(walletAddress: string): void {
  const data = exportBets(walletAddress);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `darkpool-bets-${walletAddress.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
