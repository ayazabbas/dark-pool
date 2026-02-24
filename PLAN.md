# DarkPool — Implementation Plan

> Sealed prediction markets on Starknet — bet with ZK commitments so positions and amounts stay hidden until resolution.
>
> **Hackathon:** Starknet RE{DEFINE} — Privacy Track ($9,675 STRK)
> **Deadline:** Feb 28, 2026 23:59 UTC (~5 days)
> **Builder:** Ayaz Abbas (@ayazabbas)
> **Prior art:** [Strike](https://github.com/ayazabbas/strike) — parimutuel prediction market (Solidity/BNB Chain/Pyth, won $10k at Good Vibes Only hackathon)

---

## 1. Concept

DarkPool is a binary UP/DOWN parimutuel prediction market where **both bet direction AND amount are hidden** using a Poseidon commit-reveal scheme until after market resolution.

**Problem:** On-chain prediction markets (Polymarket, Strike, etc.) expose all positions publicly. This enables:
- **Front-running:** Whales move odds, others pile on
- **Herd behavior:** Bettors copy visible majority instead of thinking independently
- **Social pressure:** No one wants to be the only contrarian when positions are public
- **Information leakage:** Market makers extract alpha from visible order flow

**Solution:** Sealed betting rounds. Users commit Poseidon hashes of their bets. Nobody — not even the contract — knows the pool split until after the oracle determines the outcome. Only then do users reveal their positions and claim payouts.

**Why this matters:** Sealed-bid mechanisms are proven to produce more honest pricing in auction theory. DarkPool applies the same principle to prediction markets — creating true price discovery from independent conviction.

**Why Starknet:** Native STARK-field Poseidon hash is dirt cheap (~600 cells, ~20μs). "Private prediction market" is **explicitly listed** as a suggested project on the hackathon page. Cairo's native hash primitives make commit-reveal a natural fit without external ZK tooling.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                  React Frontend (Vite + Tailwind + shadcn/ui)       │
│  Wallet: ArgentX / Braavos via starknet-react                       │
│  State: contract reads via starknet.js + localStorage for salts     │
│  Pages: Market, My Bets, How It Works                               │
└────────────────────────┬────────────────────────────────────────────┘
                         │  starknet.js RPC calls
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌──────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  Keeper Svc  │ │  Starknet RPC    │ │  Pyth Hermes API │
│  (Node.js)   │ │  (Sepolia)       │ │  - Price updates  │
│  - Create    │ │  - Contract      │ │  - VAA → BB       │
│    markets   │ │    state reads   │ │  - BTC/USD feed   │
│  - Resolve   │ │  - Tx submission │ └──────────────────┘
│  - Finalize  │ └──────────────────┘
└──────┬───────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Starknet (Sepolia → Mainnet)                      │
│                                                                     │
│  ┌─────────────────────────┐    ┌──────────────────────────┐       │
│  │   DarkPool Contract     │    │   Pyth Oracle Contract   │       │
│  │                         │    │   (Sepolia deployed)     │       │
│  │  commit() ─── escrow    │◄───│   get_price_no_older_    │       │
│  │  resolve() ── oracle    │    │   than()                 │       │
│  │  reveal() ── verify     │    └──────────────────────────┘       │
│  │  claim() ── payout      │                                       │
│  │  finalize() ── forfeit  │    ┌──────────────────────────┐       │
│  └─────────────────────────┘    │   STRK ERC-20            │       │
│                                 │   (bet token)            │       │
│                                 └──────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────┘
```

**Key:** No backend database. Contract is the source of truth. Salts stored client-side in localStorage (with download backup). Users connect their own wallets and sign transactions directly.

---

## 3. Contract Design (Cairo)

### Storage

```cairo
#[storage]
struct Storage {
    // Market config
    market_id: u64,
    phase: Phase,
    strike_price: i64,
    strike_price_expo: i32,
    resolution_price: i64,
    outcome: Side,                              // Up or Down

    // Timing
    start_time: u64,
    commit_deadline: u64,                       // Betting stops (= start + duration/2)
    expiry_time: u64,                           // Oracle reads price
    reveal_deadline: u64,                       // = expiry + reveal_window

    // Escrow (fixed amount — hides actual bet size)
    fixed_escrow: u256,                         // e.g. 10 STRK — everyone deposits same
    bet_token: ContractAddress,                 // STRK

    // Commitments
    commitments: Map<ContractAddress, felt252>,  // user → poseidon hash
    has_committed: Map<ContractAddress, bool>,
    commit_count: u32,

    // Reveals
    revealed_direction: Map<ContractAddress, felt252>,  // 0=Down, 1=Up
    revealed_amount: Map<ContractAddress, u256>,         // actual bet (≤ escrow)
    has_revealed: Map<ContractAddress, bool>,
    reveal_count: u32,

    // Pools (populated during reveal phase)
    up_pool: u256,
    down_pool: u256,
    total_revealed: u256,

    // Claims
    has_claimed: Map<ContractAddress, bool>,

    // Admin
    owner: ContractAddress,
    pyth_oracle: ContractAddress,
    price_feed_id: u256,
    fee_bps: u16,                               // 300 = 3%
    fee_collector: ContractAddress,
    protocol_fee_collected: bool,
}
```

### Phase State Machine

```
COMMITTING ──[commit_deadline]──► CLOSED ──[expiry + resolve()]──► RESOLVED
                                                                       │
                                                              ──[reveal]──► REVEALING
                                                                       │
                                                              ──[reveal_deadline]──► FINALIZED
```

**Key rule:** Resolution (oracle read) happens BEFORE reveals. This prevents users from selectively revealing or forfeiting based on the outcome they can see.

### Phases

| Phase | Duration | User Actions | Keeper Actions |
|-------|----------|-------------|----------------|
| **Committing** | 0 → commit_deadline (2.5 min) | `commit()` — submit hash + escrow STRK | Creates market |
| **Closed** | commit_deadline → expiry (2.5 min) | Wait | — |
| **Resolved** | After `resolve()` | — | `resolve()` — reads Pyth price |
| **Revealing** | expiry → reveal_deadline (5 min) | `reveal()` — prove your bet | — |
| **Finalized** | After reveal_deadline | `claim()` — collect payout | `finalize()` — if needed |
| **Cancelled** | Emergency only | `refund()` | `emergency_cancel()` |

### Privacy Mechanism: Commit-Reveal

**Commitment hash (Poseidon):**
```
commitment = poseidon(direction, amount, salt, user_address)
```

| Field | Type | Hidden Until Reveal? |
|-------|------|---------------------|
| `direction` | felt252 (0=Down, 1=Up) | ✅ Yes |
| `amount` | felt252 (actual bet ≤ escrow) | ✅ Yes |
| `salt` | felt252 (random 252-bit) | ✅ Yes |
| `user_address` | ContractAddress | ❌ No (prevents hash copying) |

**Why user_address in hash:** Without it, an attacker copies your commitment hash, submits from their own address, and replays your reveal later.

### Amount Privacy: Fixed Escrow

Everyone deposits the **same escrow amount** (e.g., 10 STRK). This means:
- On-chain, all commitments look identical (same transfer size)
- Actual bet amount is hidden inside the hash (can be anything from MIN_BET to escrow)
- At reveal, excess `(escrow - actual_bet)` is refunded
- **Result:** Neither direction NOR amount is visible until reveal

Without fixed escrow, the transfer amount would leak bet sizing info even though direction is hidden.

### Payout Model (Parimutuel, from Strike)

```
losing_pool = total bets on losing side
winning_pool = total bets on winning side
fee = losing_pool * fee_bps / 10000          // 3% of losers only
payout_pool = winning_pool + losing_pool - fee
user_payout = (user_bet / winning_pool) * payout_pool
```

**Edge cases:**
| Scenario | Handling |
|----------|----------|
| One-sided (all Up or all Down) | Cancel, refund all escrows |
| Exact price tie | Cancel, refund all escrows |
| No commits | Market skipped (keeper doesn't create) |
| User commits but doesn't reveal | Escrow forfeited to payout pool |
| All reveals same side | Cancel, refund revealed amounts |
| Resolution fails (Pyth down) | Admin fallback or cancel after 24h |

### Forfeiture for Non-Revealers

If a user commits but doesn't reveal by reveal_deadline:
- Their full escrow is forfeited to the payout pool
- This disincentivizes griefing (commit with no intention to reveal)
- It also punishes "strategic non-revelation" (losing and choosing not to reveal)

### External Functions

```cairo
#[starknet::interface]
trait IDarkPool<TContractState> {
    // Phase: Committing
    fn commit(ref self: TContractState, commitment_hash: felt252);

    // Phase: Closed → Resolved (permissionless, anyone can call)
    fn resolve(ref self: TContractState, pyth_price_update: ByteBuffer);

    // Phase: Revealing
    fn reveal(ref self: TContractState, direction: felt252, amount: u256, salt: felt252);

    // Phase: Finalized
    fn claim(ref self: TContractState);
    fn refund(ref self: TContractState);  // Only for Cancelled markets

    // Admin
    fn finalize(ref self: TContractState);  // Force finalize after reveal deadline
    fn emergency_cancel(ref self: TContractState);

    // View functions
    fn get_market_info(self: @TContractState) -> MarketInfo;
    fn get_phase(self: @TContractState) -> Phase;
    fn get_commitment(self: @TContractState, user: ContractAddress) -> felt252;
    fn has_user_committed(self: @TContractState, user: ContractAddress) -> bool;
    fn has_user_revealed(self: @TContractState, user: ContractAddress) -> bool;
    fn get_pool_sizes(self: @TContractState) -> (u256, u256, u256);  // up, down, total
}
```

---

## 4. Frontend Design (React + Tailwind + shadcn/ui)

### Pages & Layout

Single-page app with a top nav bar and main content area. Dark theme (fits "DarkPool" brand).

**Nav Bar:**
- Logo + "DarkPool" branding
- Live BTC price ticker (Pyth Hermes websocket)
- Connect Wallet button (ArgentX / Braavos)
- Connected address display

**Main Views:**

```
┌─────────────────────────────────────────────────────┐
│  [DarkPool]          BTC $97,432.15     [Connect]   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │           LIVE MARKET                        │   │
│  │                                              │   │
│  │  Phase: COMMITTING        ⏱ 1:47 remaining  │   │
│  │  Strike: $97,412.30       Commits: 7 🔒      │   │
│  │  Escrow: 10 STRK                             │   │
│  │                                              │   │
│  │  ┌──────────┐  ┌──────────┐                  │   │
│  │  │  📈 UP   │  │  📉 DOWN │                  │   │
│  │  └──────────┘  └──────────┘                  │   │
│  │                                              │   │
│  │  Amount: [____] STRK (max 10)                │   │
│  │  [Seal Your Bet 🔒]                          │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─ My Active Bets ────────────────────────────┐   │
│  │  Market #42: 🔒 Sealed (reveal in 3:20)     │   │
│  │  Market #41: ✅ Won +4.2 STRK [Claim]       │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─ How It Works ──────────────────────────────┐   │
│  │  Collapsible explainer section               │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Component Breakdown

| Component | Description |
|-----------|-------------|
| `ConnectButton` | starknet-react wallet connection (ArgentX/Braavos) |
| `PriceTicker` | Live BTC/USD price from Pyth Hermes websocket |
| `MarketCard` | Current market phase, timer, strike price, commit count |
| `BetPanel` | UP/DOWN buttons, amount input, commit action |
| `RevealPanel` | Shows when Revealing phase — one-click reveal |
| `ClaimPanel` | Shows when Finalized — payout amount + claim button |
| `MyBets` | List of user's active and historical bets |
| `TxStatus` | Toast notifications for pending/confirmed/failed txs |
| `HowItWorks` | Accordion/collapsible explainer |
| `PhaseIndicator` | Visual pipeline: Commit → Closed → Resolved → Reveal → Done |

### Wallet Integration (starknet-react)

Users connect their own ArgentX or Braavos browser wallet. No server-managed keys.

```typescript
import { useAccount, useConnect, useContract } from '@starknet-react/core';

// Connect wallet
const { connect, connectors } = useConnect();

// Read contract
const { data: marketInfo } = useContractRead({
  address: DARKPOOL_ADDRESS,
  abi: DARKPOOL_ABI,
  functionName: 'get_market_info',
});

// Write contract (user signs via wallet)
const { writeAsync } = useContractWrite({
  calls: [approveCall, commitCall],
});
```

### Salt Management (Client-Side)

Salts are critical — lose a salt, lose your bet. Stored in **localStorage** with backup options:

```typescript
// On commit:
const salt = stark.randomAddress();  // Random felt252
localStorage.setItem(`darkpool:salt:${marketAddr}:${userAddr}`, salt);

// On reveal:
const salt = localStorage.getItem(`darkpool:salt:${marketAddr}:${userAddr}`);
```

**Safety features:**
- **Backup download:** Button to download all active salts as JSON file
- **Warning banner:** "Don't clear browser data while you have active bets"
- **Salt display:** Users can view their salt for manual backup
- **Import:** Paste a salt to recover a bet if localStorage is lost

### Client-Side Poseidon Hashing

```typescript
import { hash } from 'starknet';

function computeCommitment(
  direction: 0 | 1,   // 0=Down, 1=Up
  amount: bigint,      // in wei
  salt: string,        // felt252 hex
  userAddress: string  // felt252 hex
): string {
  return hash.computePoseidonHashOnElements([
    direction,
    amount.toString(),
    salt,
    userAddress,
  ]);
}
```

### Auto-Reveal (Client-Side)

If the user keeps the tab open, the frontend polls for phase changes and auto-submits the reveal transaction when the market enters Revealing phase:

```typescript
useEffect(() => {
  if (phase === 'Revealing' && myBet && !myBet.revealed) {
    autoReveal(myBet.direction, myBet.amount, myBet.salt);
  }
}, [phase]);
```

The wallet popup will appear for the user to approve the reveal tx. If the tab is closed, the user must return and click "Reveal" manually within the reveal window.

---

## 5. Keeper Service

Standalone Node.js script that manages the market lifecycle. Runs independently from the frontend.

```
┌─────────────────────────────────────────────┐
│               Keeper Loop                    │
│                                              │
│  Every 5 minutes (aligned to wall clock):    │
│  1. Create new market (deploy or call factory)│
│  2. Check expired markets → resolve()        │
│  3. Check reveal deadline → finalize()       │
└─────────────────────────────────────────────┘
```

### Market Lifecycle (10-minute total cycle)

```
T+0:00  ──► Market created (keeper), Committing phase begins
T+2:30  ──► Commit deadline, Closed phase (no more bets)
T+5:00  ──► Expiry, keeper calls resolve() with Pyth price
T+5:00  ──► Revealing phase begins
T+10:00 ──► Reveal deadline, keeper calls finalize()
T+10:00 ──► Finalized, users can claim payouts
```

**Why 2.5 min commit + 2.5 min closed + 5 min reveal:**
- Commit window matches Strike's betting window
- Closed period lets the oracle price diverge from strike (creates the bet)
- 5-minute reveal window gives users time to reveal (frontend auto-reveals if tab is open)

---

## 6. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Contract** | Cairo | 2.16.0 |
| **Build** | Scarb | 2.16.0 |
| **Test** | Starknet Foundry (snforge) | 0.56.0 |
| **Deploy** | sncast | 0.56.0 |
| **Contract libs** | OpenZeppelin Cairo | 0.20.0 |
| **Hash** | Poseidon (Cairo native) | built-in |
| **Oracle** | Pyth Network | Pull oracle |
| **Frontend** | React + TypeScript (Vite) | 19.x / 6.x |
| **Styling** | Tailwind CSS + shadcn/ui | 4.x / latest |
| **Wallet** | starknet-react | latest |
| **JS SDK** | starknet.js | 6.x |
| **Pyth client** | @pythnetwork/pyth-starknet-js | latest |
| **Keeper** | Node.js + TypeScript | 22.x |
| **Bet token** | STRK (ERC-20) | — |
| **Chain** | Starknet Sepolia (testnet) | — |

### Key Addresses

```
# Starknet Sepolia
STRK:     0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
ETH:      0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7
Pyth:     0x07f2b07b6b5365e7ee055bda4c0ecabd867e6d3ee298d73aea32b027667186d6

# Starknet Mainnet
Pyth:     0x062ab68d8e23a7aa0d5bf4d25380c2d54f2dd8f83012e047851c3706b53d64d1

# Pyth Price Feed IDs
BTC/USD:  0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
```

### Scarb.toml

```toml
[package]
name = "darkpool"
version = "0.1.0"
edition = "2024_07"

[dependencies]
starknet = ">=2.16.0"
openzeppelin_token = "0.20.0"
openzeppelin_access = "0.20.0"
pyth = { git = "https://github.com/pyth-network/pyth-crosschain.git", tag = "pyth-starknet-contract-v0.1.0" }

[dev-dependencies]
snforge_std = "0.56.0"

[[target.starknet-contract]]
sierra = true
casm = true
```

### Pyth Integration (Starknet-Specific)

Unlike EVM Pyth (pass bytes[] + ETH for fee), Starknet Pyth uses:

1. **ByteBuffer format:** Price updates must be converted to `ByteBuffer` (Pyth's Starknet type)
2. **STRK fee payment:** No native token passing. Must explicitly:
   - Call `pyth.get_update_fee(update_data, strk_address)` to get fee
   - `transferFrom` STRK from caller to contract
   - `approve` Pyth contract to spend STRK
   - Call `pyth.update_price_feeds(update_data)`
3. **Client-side:** Use `@pythnetwork/pyth-starknet-js` to convert Hermes VAA to ByteBuffer

```cairo
// In resolve():
let pyth = IPythDispatcher { contract_address: self.pyth_oracle.read() };
let strk = IERC20CamelDispatcher { contract_address: self.bet_token.read() };

// Pay fee
let fee = pyth.get_update_fee(pyth_price_update.clone(), strk.contract_address);
strk.approve(pyth.contract_address, fee);

// Update price feeds
pyth.update_price_feeds(pyth_price_update);

// Read price
let price = pyth.get_price_no_older_than(self.price_feed_id.read(), MAX_PRICE_AGE);
```

---

## 7. Project Structure

```
dark-pool/
├── PLAN.md                          # This file
├── README.md                        # Project overview + setup
├── contracts/                       # Cairo smart contracts
│   ├── Scarb.toml
│   ├── src/
│   │   ├── lib.cairo                # Module root
│   │   ├── darkpool.cairo           # Main contract
│   │   ├── types.cairo              # Structs, enums, events
│   │   ├── hash.cairo               # Poseidon commitment helper
│   │   └── interfaces.cairo         # Contract interface
│   └── tests/
│       ├── test_commit.cairo
│       ├── test_resolve.cairo
│       ├── test_reveal.cairo
│       ├── test_claim.cairo
│       └── test_edge_cases.cairo
├── frontend/                        # React + Tailwind + shadcn/ui
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── components.json              # shadcn/ui config
│   ├── index.html
│   ├── public/
│   └── src/
│       ├── main.tsx                 # Entry point
│       ├── App.tsx                  # Root layout + routes
│       ├── lib/
│       │   ├── starknet.ts          # Provider config, contract ABIs
│       │   ├── commitment.ts        # Poseidon hash computation
│       │   ├── salts.ts             # localStorage salt management
│       │   ├── pyth.ts              # Hermes API + price fetching
│       │   └── constants.ts         # Addresses, feed IDs, config
│       ├── hooks/
│       │   ├── useMarket.ts         # Market state polling
│       │   ├── useMyBets.ts         # User's bet history
│       │   ├── usePhaseTimer.ts     # Countdown timer
│       │   └── usePythPrice.ts      # Live BTC price
│       ├── components/
│       │   ├── ui/                  # shadcn/ui components
│       │   ├── ConnectButton.tsx    # Wallet connection
│       │   ├── PriceTicker.tsx      # Live BTC/USD price
│       │   ├── MarketCard.tsx       # Market info display
│       │   ├── BetPanel.tsx         # UP/DOWN + amount + commit
│       │   ├── RevealPanel.tsx      # Reveal action
│       │   ├── ClaimPanel.tsx       # Claim payout
│       │   ├── MyBets.tsx           # Bet history list
│       │   ├── PhaseIndicator.tsx   # Visual phase pipeline
│       │   ├── TxToast.tsx          # Transaction status toasts
│       │   └── HowItWorks.tsx       # Explainer accordion
│       └── providers/
│           └── StarknetProvider.tsx  # starknet-react provider setup
├── keeper/                          # Market lifecycle service
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                 # Keeper entry point
│       ├── config.ts                # Environment config
│       └── services/
│           ├── starknet.ts          # Contract interaction
│           └── pyth.ts              # Hermes API + ByteBuffer
├── scripts/
│   ├── deploy.ts                    # Deploy contract to Sepolia
│   ├── create-market.ts             # Manual market creation
│   └── fund-account.ts              # Fund test accounts
└── docs/
    └── README.md                    # Extended documentation
```

---

## 8. Client-Side State (localStorage)

No backend database. All user state lives in localStorage, keyed by wallet address:

```typescript
// Salt storage (critical — lose this, lose your bet)
interface StoredBet {
  marketAddress: string;
  direction: 0 | 1;      // 0=Down, 1=Up
  amount: string;         // wei string
  salt: string;           // felt252 hex
  commitmentHash: string; // Poseidon hash hex
  commitTx?: string;      // tx hash
  revealTx?: string;
  claimTx?: string;
  status: 'committed' | 'revealed' | 'claimed' | 'forfeited';
  timestamp: number;
}

// localStorage keys:
// darkpool:bets:<walletAddress>       → StoredBet[]
// darkpool:settings:<walletAddress>   → { quickBets: [1, 5, 10] }
```

**Safety features:**
- ⚠️ Warning banner when user has unrevealed bets: "Don't clear browser data!"
- 📥 "Export Salts" button → downloads JSON backup of all active bets
- 📤 "Import Salts" → restore from backup file
- 🔒 Salt is displayed in bet detail view for manual copying

**Contract is source of truth** for market state, commitments, reveals, and pool sizes. localStorage only stores secrets (salts, directions, amounts) that the user needs for reveal.

---

## 9. Development Phases

### Phase 1 — Contract Core (Day 1: Feb 24)
**Goal:** Compilable contract with commit + phase transitions + tests

**Tasks:**
- [ ] **1.1** Initialize Scarb project with dependencies (OZ, Pyth, snforge)
- [ ] **1.2** Define types: `Phase` enum, `Side` enum, `MarketInfo` struct, events
- [ ] **1.3** Define storage struct and interface trait
- [ ] **1.4** Implement `commit()`:
  - Verify phase is Committing
  - Verify user hasn't already committed
  - Pull fixed_escrow STRK via `transferFrom`
  - Store commitment hash
  - Emit `Committed` event
- [ ] **1.5** Implement Poseidon commitment helper + verification:
  ```cairo
  fn compute_commitment(direction: felt252, amount: felt252, salt: felt252, user: ContractAddress) -> felt252
  fn verify_commitment(stored: felt252, direction: felt252, amount: felt252, salt: felt252, user: ContractAddress) -> bool
  ```
- [ ] **1.6** Implement phase transitions (time-based auto-advance)
- [ ] **1.7** Write tests: commit works, duplicate rejected, wrong phase rejected, phase auto-advances
- [ ] **1.8** Verify Poseidon hash output matches starknet.js `hash.computePoseidonHashOnElements()` — **CRITICAL compatibility test**

**Milestone:** `snforge test` passes 8+ tests, contract compiles

### Phase 2 — Resolution + Reveal (Day 2: Feb 25)
**Goal:** Full commit → resolve → reveal lifecycle in tests

**Tasks:**
- [ ] **2.1** Implement `resolve()`:
  - Verify phase is Closed and past expiry
  - Accept Pyth ByteBuffer price update
  - Pay Pyth fee (STRK approve + update_price_feeds)
  - Read BTC/USD price via `get_price_no_older_than`
  - Compare to strike price, set outcome (Up/Down)
  - Transition to Resolved phase
  - Emit `MarketResolved` event
- [ ] **2.2** Implement `reveal()`:
  - Verify phase is Revealing (after resolution)
  - Recompute Poseidon hash from inputs
  - Verify matches stored commitment
  - Verify amount ≤ fixed_escrow
  - Record direction + amount
  - Add to up_pool or down_pool
  - Refund excess (escrow - amount) immediately
  - Emit `Revealed` event
- [ ] **2.3** Implement `finalize()`:
  - After reveal_deadline
  - Forfeit unrevealed escrows to payout pool
  - Set phase to Finalized
- [ ] **2.4** Mock Pyth oracle for tests (hardcoded price return)
- [ ] **2.5** Write tests: full lifecycle (commit → resolve → reveal → finalize), wrong reveal rejected, late reveal rejected, forfeiture works
- [ ] **2.6** Test with real Pyth on Sepolia devnet if possible

**Milestone:** Complete lifecycle in tests, 15+ tests passing

### Phase 3 — Payouts + Edge Cases (Day 2-3: Feb 25-26)
**Goal:** Payout math, fee collection, all edge cases handled

**Tasks:**
- [ ] **3.1** Implement `claim()`:
  - Verify phase is Finalized
  - Verify user revealed and is on winning side
  - Calculate parimutuel payout (share of pool)
  - Transfer STRK to user
  - Emit `Claimed` event
- [ ] **3.2** Implement fee collection:
  - 3% of losing pool
  - `collect_fees()` for fee collector address
- [ ] **3.3** Implement `refund()` for Cancelled markets
- [ ] **3.4** Implement `emergency_cancel()` (owner only)
- [ ] **3.5** Handle edge cases:
  - One-sided market (all up or all down after reveals) → Cancel
  - No reveals → Cancel, return escrows
  - Exact price tie → Cancel
  - Resolution deadline (24h no resolution) → Auto-cancel
- [ ] **3.6** Write edge case tests (20+ total tests)

**Milestone:** All contract logic complete, all edge cases tested

### Phase 4 — Deploy + Frontend Scaffold (Day 3: Feb 26)
**Goal:** Contract on Sepolia, React app connecting to it

**Tasks:**
- [ ] **4.1** Deploy contract to Starknet Sepolia via sncast
- [ ] **4.2** Verify on Starkscan/Voyager
- [ ] **4.3** Test commit + resolve + reveal + claim on Sepolia manually (via sncast CLI)
- [ ] **4.4** Scaffold frontend: `npm create vite@latest -- --template react-ts`
- [ ] **4.5** Install + configure Tailwind CSS 4 + shadcn/ui
- [ ] **4.6** Set up starknet-react provider (StarknetConfig, RPC provider, connectors)
- [ ] **4.7** Build ConnectButton component (ArgentX / Braavos)
- [ ] **4.8** Implement `lib/commitment.ts` — Poseidon hashing via starknet.js
- [ ] **4.9** Implement `lib/salts.ts` — localStorage salt management + export/import
- [ ] **4.10** Implement `lib/starknet.ts` — contract ABI + read/write helpers
- [ ] **4.11** Scaffold keeper: Node.js script with market creation + resolution loop

**Milestone:** Frontend connects wallet, reads contract state, contract on Sepolia

### Phase 5 — Frontend Core Flows + Keeper (Day 4: Feb 27)
**Goal:** Full betting flow through the web UI

**Tasks:**
- [ ] **5.1** Implement `usePythPrice` hook — live BTC/USD price from Hermes API
- [ ] **5.2** Implement `useMarket` hook — polls contract for market state, phase, timers
- [ ] **5.3** Build `MarketCard` — phase indicator, strike price, countdown timer, commit count
- [ ] **5.4** Build `BetPanel` — UP/DOWN selection, amount input (slider or quick buttons), commit action:
  - Generate salt → compute Poseidon hash → approve STRK → call commit()
  - Save salt + bet details to localStorage
  - Show tx confirmation toast with explorer link
- [ ] **5.5** Build `RevealPanel` — one-click reveal when phase is Revealing:
  - Load salt from localStorage → call reveal(direction, amount, salt)
  - Auto-reveal if tab is open (useEffect on phase change)
  - Show tx confirmation
- [ ] **5.6** Build `ClaimPanel` — payout display + claim button when Finalized:
  - Calculate estimated payout from pool sizes
  - Call claim() → show result with tx link
- [ ] **5.7** Build `MyBets` — list of user's bets from localStorage + contract state
- [ ] **5.8** Build `PriceTicker` — live BTC price in nav bar
- [ ] **5.9** Build `HowItWorks` — collapsible accordion explaining sealed betting
- [ ] **5.10** Implement keeper: create markets at 5-min boundaries, resolve with Pyth, finalize after reveal deadline

**Milestone:** Full flow working: connect wallet → commit → reveal → claim

### Phase 6 — Integration Testing + Polish (Day 4-5: Feb 27-28)
**Goal:** E2E tested, polished, demo-ready

**Tasks:**
- [ ] **6.1** E2E test: 2+ wallets, both outcomes, payout verification
- [ ] **6.2** E2E test: forfeiture (don't reveal, verify escrow forfeited)
- [ ] **6.3** E2E test: one-sided market → cancellation
- [ ] **6.4** UI polish: loading spinners, error toasts, timer formatting, dark theme tuning
- [ ] **6.5** Privacy indicators (🔒 icons, "Your bet is sealed" messages, phase pipeline visualization)
- [ ] **6.6** Salt backup UX: export/import buttons, warning banners
- [ ] **6.7** Mobile responsive layout
- [ ] **6.8** README: project overview, setup instructions, architecture diagram, screenshots
- [ ] **6.9** Deploy frontend (Vercel or GitHub Pages)
- [ ] **6.10** Fix any bugs from E2E testing

**Milestone:** Stable, polished, deployed, ready for demo

### Phase 7 — Submission (Day 5: Feb 28)
**Goal:** Submitted to DoraHacks before 23:59 UTC

**Tasks:**
- [ ] **7.1** Record demo video (3 min max):
  - Intro: "Prediction markets leak your positions. DarkPool seals them."
  - Show connecting wallet, live BTC price, market view
  - Show two browser windows: two users committing hidden bets (sealed UI)
  - Show Starkscan: commitments look identical (same escrow, opaque hashes)
  - Show market resolving via Pyth oracle, phase transition
  - Show reveals — positions finally visible after outcome known
  - Show winner claiming payout
  - Closing: "No front-running. No herding. Just conviction."
- [ ] **7.2** Write 500-word project description
- [ ] **7.3** Final test on Sepolia
- [ ] **7.4** Submit to DoraHacks:
  - GitHub repo link
  - Demo video
  - Description
  - Contract address
  - Track: Privacy
- [ ] **7.5** Double-check all submission requirements met

**Milestone:** SUBMITTED ✅

---

## 10. MVP vs Stretch Goals

### MVP (Must Ship)

| Feature | Phase |
|---------|-------|
| Poseidon commit-reveal contract | 1-2 |
| Phase state machine with timing | 1 |
| Fixed escrow (hides amount + direction) | 1 |
| Pyth Oracle resolution | 2 |
| Parimutuel payout + edge cases | 3 |
| Reveal verification + forfeiture | 2-3 |
| Starknet Sepolia deployment | 4 |
| React frontend: connect + commit + reveal + claim | 4-5 |
| Client-side salt management + backup | 4-5 |
| Keeper: market creation + resolution + finalization | 5 |
| Demo video + submission | 7 |

### Stretch Goals (If Time Permits)

| Feature | Complexity | Impact |
|---------|-----------|--------|
| Market factory (multiple concurrent markets) | Medium | Production-like |
| Time-weighted shares (early bird multiplier from Strike) | Low | Fairer incentives |
| Claim All button (batch claims) | Low | QoL |
| Market history with stats | Low | Engagement |

### Out of Scope

Mainnet deploy, tokenomics, AMM/orderbook, cross-chain, AI, mobile app, Telegram bot

---

## 11. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Cairo learning curve (Ayaz new to it) | 🔴 High | Adapt from previous private-strike research; comprehensive Cairo notes in plan |
| Pyth ByteBuffer integration on Starknet | 🔴 High | Test in Phase 2; admin fallback price if Pyth fails |
| starknet.js Poseidon compat with Cairo | 🔴 High | Test hash matching in Phase 1 Task 1.8 BEFORE building more |
| Salt loss (user clears localStorage) | 🟡 Medium | Export/import backup, warning banners, salt display in UI |
| User forgets to reveal (tab closed) | 🟡 Medium | Clear phase indicator, countdown urgency UI, escrow forfeiture warning |
| 5-day timeline | 🔴 High | Reuse Strike patterns; AI coding agents for boilerplate |
| Starknet Sepolia stability | 🟡 Medium | Have local devnet as fallback |

---

## 12. Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Privacy mechanism | Poseidon commit-reveal | Zero external deps, native Cairo, proven pattern |
| Hash function | Poseidon (not Pedersen) | 5x cheaper in Cairo, STARK-native |
| Amount privacy | Fixed escrow | All commits look identical on-chain |
| Oracle | Pyth Network | Pull oracle, deployed on Starknet, Ayaz works at Pyth's parent co |
| Interface | React web app | Better UX for market visualization, wallet connect standard, demo-friendly |
| Wallet | ArgentX / Braavos (starknet-react) | User-controlled, no custodial risk, standard Starknet UX |
| Salt storage | Client-side (localStorage) | No server trust needed; export/import backup for safety |
| Auto-reveal | Client-side (if tab open) | Frontend polls phase + auto-submits reveal; manual fallback |
| Bet token | STRK | Native gas token, faucet available on Sepolia |
| Contract pattern | Single contract (no factory) | MVP simplicity; factory is stretch goal |
| Phase ordering | Commit → Resolve → Reveal | Prevents strategic non-revelation |
| Fee model | 3% of losing side | Winners don't subsidize protocol (from Strike) |
| Forfeiture | Unrevealed escrows → pool | Disincentivizes griefing |

---

## 13. Submission Checklist

Per RE{DEFINE} hackathon (DoraHacks, deadline Feb 28, 23:59 UTC):

- [ ] Working contract on Starknet Sepolia (or mainnet)
- [ ] Public GitHub repo: https://github.com/ayazabbas/dark-pool
- [ ] Demo video (3 min max)
- [ ] 500-word project description
- [ ] Track: **Privacy**
- [ ] Contract verified on Starkscan/Voyager
- [ ] README with setup + architecture

---

## 14. References

**Starknet/Cairo:**
- [Cairo Book](https://www.starknet.io/cairo-book/)
- [Cairo Book: Hashes (Poseidon)](https://www.starknet.io/cairo-book/ch12-04-hash.html)
- [Starknet Foundry](https://github.com/foundry-rs/starknet-foundry)
- [OpenZeppelin Cairo](https://github.com/OpenZeppelin/cairo-contracts)
- [starknet.js Docs](https://starknetjs.com/docs/guides/interact/)

**Pyth on Starknet:**
- [Pyth Starknet Integration Guide](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/starknet)
- [Pyth Starknet Contract Addresses](https://docs.pyth.network/price-feeds/core/contract-addresses/starknet)
- [Pyth Starknet JS SDK](https://www.npmjs.com/package/@pythnetwork/pyth-starknet-js)
- [Pyth Price Feed IDs](https://pyth.network/developers/price-feed-ids)

**Hackathon:**
- [RE{DEFINE} Hackathon Page](https://hackathon.starknet.org/)
- [DoraHacks Submission](https://dorahacks.io/hackathon/redefine)

**Prior Art:**
- [Strike (original)](https://github.com/ayazabbas/strike) — Solidity/BNB Chain
- [Private Strike Research](~/dev/starknet-private-strike/) — Previous scoping (not built)
