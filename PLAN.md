# DarkPool — Implementation Plan

> Sealed prediction markets on Starknet — bet with ZK commitments so positions and amounts stay hidden until resolution.
>
> **Hackathon:** Starknet RE{DEFINE} — Privacy Track ($9,675 STRK)
> **Deadline:** Feb 28, 2026 23:59 UTC (~5 days)
> **Builder:** Ayaz Abbas (@ayazabbas)
> **Prior art:** [Strike](https://github.com/ayazabbas/strike) — parimutuel prediction market (Solidity/BNB Chain/Pyth/Telegram bot, won $10k at Good Vibes Only hackathon)

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
│                     Telegram Bot (Grammy)                           │
│  Commands: /start, /help, /settings                                 │
│  Inline keyboards: Market view, Bet, Reveal, Claim, Wallet         │
│  Server-managed wallets (starknet.js Account per user)              │
└────────────────────────┬────────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│  Keeper Svc  │ │  SQLite DB   │ │  Pyth Hermes API │
│  - Create    │ │  - Users     │ │  - Price updates  │
│    markets   │ │  - Bets      │ │  - VAA data       │
│  - Resolve   │ │  - Salts     │ │  - BTC/USD feed   │
│  - Finalize  │ │  - Wallets   │ └──────────────────┘
└──────┬───────┘ └──────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Starknet (Sepolia → Mainnet)                      │
│                                                                     │
│  ┌─────────────────────────┐    ┌──────────────────────────┐       │
│  │   DarkPool Contract   │    │   Pyth Oracle Contract   │       │
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

## 4. Telegram Bot Design

### UX Flow (User Perspective)

```
/start → Welcome + Create Wallet
  │
  ├── 🎯 Live Market
  │     Shows: BTC price, strike price, time left, phase, commit count
  │     Phase: Committing → [Pick UP/DOWN] → [Confirm amount] → Committed ✅
  │     Phase: Revealing → [Reveal button] → Revealed ✅
  │     Phase: Finalized → [Claim button] → Payout received 🎉
  │
  ├── 💰 My Wallet
  │     Balance, address, deposit/withdraw
  │
  ├── 📊 My Bets
  │     Active commitments (hidden direction 🔒)
  │     Past results with P&L
  │
  └── ❓ How It Works
        3-page explainer on sealed betting
```

### Bot Commands

| Command | Handler | Description |
|---------|---------|-------------|
| `/start` | `start.ts` | Welcome, auto-create wallet |
| `/help` | `help.ts` | Quick guide |
| `/settings` | `settings.ts` | Quick-bet amounts |

### Callback Handlers

| Callback Data | Handler | Action |
|--------------|---------|--------|
| `live` / `markets` | `markets.ts` | Show current market |
| `bet:<side>` | `betting.ts` | Start commit flow |
| `confirm:<side>:<amount>` | `betting.ts` | Execute commit tx |
| `reveal` | `reveal.ts` | Execute reveal tx |
| `claim` | `claim.ts` | Execute claim tx |
| `wallet` | `wallet.ts` | Show wallet info |
| `mybets` | `mybets.ts` | Show bet history |
| `howitworks` | `howitworks.ts` | Explainer pages |

### Server-Managed Wallets (starknet.js)

Strike used Privy for EVM server wallets. For Starknet, we use **starknet.js Account** directly:

```typescript
import { Account, RpcProvider, ec, stark } from 'starknet';

// Generate keypair for new user
const privateKey = stark.randomAddress();
const publicKey = ec.starkCurve.getStarkKey(privateKey);

// Deploy account (OpenZeppelin Account)
// Pre-compute address, fund with STRK, deploy
const account = new Account(provider, address, privateKey);
```

Each Telegram user gets:
1. A Starknet keypair (private key encrypted + stored in DB)
2. An OpenZeppelin Account contract deployed on their first bet
3. The bot signs and submits transactions on their behalf

**Security:** Private keys are encrypted at rest with a server-side key. Users can export their key via `/settings` if needed.

### Salt Management

Salts are critical — lose a salt, lose your bet. The bot manages salts server-side:

```typescript
// On commit:
const salt = stark.randomAddress();  // Random felt252
db.saveSalt(telegramId, marketAddress, salt);

// On reveal:
const salt = db.getSalt(telegramId, marketAddress);
```

Salts stored in SQLite alongside bet records. Server-managed = no user key management burden.

---

## 5. Keeper Service

Runs alongside the bot (like Strike's keeper):

```
┌─────────────────────────────────────────────┐
│               Keeper Loop                    │
│                                              │
│  Every 5 minutes (aligned to wall clock):    │
│  1. Create new market                        │
│  2. Check expired markets → resolve()        │
│  3. Check reveal deadline → finalize()       │
│  4. Notify bettors to reveal (via bot)       │
└─────────────────────────────────────────────┘
```

### Market Lifecycle (10-minute total cycle)

```
T+0:00  ──► Market created (keeper), Committing phase begins
T+2:30  ──► Commit deadline, Closed phase (no more bets)
T+5:00  ──► Expiry, keeper calls resolve() with Pyth price
T+5:00  ──► Revealing phase begins, bot notifies users to reveal
T+10:00 ──► Reveal deadline, keeper calls finalize()
T+10:00 ──► Finalized, users can claim payouts
```

**Why 2.5 min commit + 2.5 min closed + 5 min reveal:**
- Commit window matches Strike's betting window
- Closed period lets the oracle price diverge from strike (creates the bet)
- 5-minute reveal window gives users ample time to reveal (bot auto-reveals)

### Auto-Reveal

The bot can auto-reveal for users since it holds their salts. This happens immediately when the market enters Revealing phase:

```typescript
// Keeper: on phase change to Resolved
for (const bet of db.getUnrevealedBets(marketAddress)) {
    await revealBet(bet.walletId, marketAddress, bet.direction, bet.amount, bet.salt);
}
```

**This is a major UX win** — users don't need to come back to reveal. The privacy guarantee still holds because reveals only happen after resolution.

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
| **Bot framework** | Grammy | 1.x |
| **Bot runtime** | Node.js + TypeScript | 22.x |
| **JS SDK** | starknet.js | 6.x |
| **Pyth client** | @pythnetwork/pyth-starknet-js | latest |
| **Database** | better-sqlite3 | latest |
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
│   │   ├── darkpool.cairo         # Main contract
│   │   ├── types.cairo              # Structs, enums, events
│   │   ├── hash.cairo               # Poseidon commitment helper
│   │   └── interfaces.cairo         # Contract interface
│   └── tests/
│       ├── test_commit.cairo
│       ├── test_resolve.cairo
│       ├── test_reveal.cairo
│       ├── test_claim.cairo
│       └── test_edge_cases.cairo
├── bot/                             # Telegram bot (TypeScript)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                 # Bot entry point
│   │   ├── config.ts                # Environment config
│   │   ├── keeper.ts                # Market lifecycle manager
│   │   ├── db/
│   │   │   └── database.ts          # SQLite schema + queries
│   │   ├── handlers/
│   │   │   ├── start.ts             # /start command
│   │   │   ├── markets.ts           # Market display
│   │   │   ├── betting.ts           # Commit flow
│   │   │   ├── reveal.ts            # Reveal flow
│   │   │   ├── claim.ts             # Claim/refund
│   │   │   ├── wallet.ts            # Wallet management
│   │   │   ├── mybets.ts            # Bet history
│   │   │   ├── help.ts              # Help text
│   │   │   ├── howitworks.ts        # Explainer
│   │   │   └── admin.ts             # Admin commands
│   │   └── services/
│   │       ├── starknet.ts          # starknet.js interactions
│   │       ├── wallet.ts            # Account management
│   │       ├── pyth.ts              # Hermes API + ByteBuffer
│   │       ├── commitment.ts        # Poseidon hash (client-side)
│   │       └── notifications.ts     # User notifications
│   └── data/                        # SQLite DB (gitignored)
├── scripts/
│   ├── deploy.ts                    # Deploy contract to Sepolia
│   ├── create-market.ts             # Manual market creation
│   └── fund-account.ts              # Fund test accounts
└── docs/
    └── README.md                    # Extended documentation
```

---

## 8. Database Schema

```sql
CREATE TABLE users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    starknet_address TEXT NOT NULL,
    encrypted_private_key TEXT NOT NULL,    -- AES-256-GCM encrypted
    account_deployed BOOLEAN DEFAULT FALSE,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    market_id TEXT NOT NULL,               -- Contract address
    direction TEXT NOT NULL,               -- 'up' or 'down'
    amount TEXT NOT NULL,                  -- Actual bet amount (STRK, decimal string)
    salt TEXT NOT NULL,                    -- felt252 hex string
    commitment_hash TEXT NOT NULL,         -- Poseidon hash hex string
    commit_tx TEXT,                        -- Commit transaction hash
    reveal_tx TEXT,                        -- Reveal transaction hash
    claim_tx TEXT,                         -- Claim transaction hash
    status TEXT DEFAULT 'committed',       -- committed | revealed | claimed | forfeited | refunded
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE markets (
    address TEXT PRIMARY KEY,
    market_id INTEGER,
    phase TEXT NOT NULL,                   -- committing | closed | resolved | revealing | finalized | cancelled
    strike_price TEXT,
    resolution_price TEXT,
    outcome TEXT,                          -- 'up' | 'down' | null
    start_time INTEGER,
    commit_deadline INTEGER,
    expiry_time INTEGER,
    reveal_deadline INTEGER,
    commit_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE user_settings (
    telegram_id INTEGER PRIMARY KEY,
    quick_bet_1 TEXT NOT NULL DEFAULT '1',
    quick_bet_2 TEXT NOT NULL DEFAULT '5',
    quick_bet_3 TEXT NOT NULL DEFAULT '10',
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);
```

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

### Phase 4 — Deploy + Bot Scaffold (Day 3: Feb 26)
**Goal:** Contract on Sepolia, bot serving /start

**Tasks:**
- [ ] **4.1** Deploy contract to Starknet Sepolia via sncast
- [ ] **4.2** Verify on Starkscan/Voyager
- [ ] **4.3** Test commit + resolve + reveal + claim on Sepolia manually
- [ ] **4.4** Scaffold bot: Grammy + TypeScript + better-sqlite3
- [ ] **4.5** Implement wallet service (starknet.js Account creation + encryption)
- [ ] **4.6** Implement commitment service (Poseidon hashing client-side)
- [ ] **4.7** Implement Starknet service (contract interaction wrappers)
- [ ] **4.8** Implement Pyth service (Hermes API + ByteBuffer conversion)
- [ ] **4.9** Implement `/start` → wallet creation → main menu
- [ ] **4.10** Create keeper service scaffold (market creation loop)

**Milestone:** Bot running, wallet creation works, contract on Sepolia

### Phase 5 — Bot Core Flows (Day 4: Feb 27)
**Goal:** Full betting flow through Telegram

**Tasks:**
- [ ] **5.1** Implement market display handler (live market view with timer + phase + commit count)
- [ ] **5.2** Implement commit flow:
  - User picks UP/DOWN
  - User confirms amount (quick-bet buttons + custom)
  - Bot generates salt, computes Poseidon hash
  - Bot approves STRK + calls commit() on user's behalf
  - Shows confirmation with tx link
- [ ] **5.3** Implement reveal flow:
  - Bot detects Revealing phase
  - Auto-reveals all committed users (since bot holds salts)
  - Shows reveal confirmation
- [ ] **5.4** Implement claim flow:
  - Bot detects Finalized phase
  - Shows payout amount
  - User taps Claim → bot calls claim()
  - Shows result with tx link
- [ ] **5.5** Implement My Bets page (active + history)
- [ ] **5.6** Implement wallet page (balance, deposit address)
- [ ] **5.7** Implement How It Works explainer (sealed betting concept)
- [ ] **5.8** Implement keeper: create markets at 5-min boundaries, resolve, finalize
- [ ] **5.9** Implement notifications: alert users when reveal phase starts, when payout ready

**Milestone:** Full flow working: commit → auto-reveal → claim, via Telegram

### Phase 6 — Integration Testing + Polish (Day 4-5: Feb 27-28)
**Goal:** E2E tested, polished, demo-ready

**Tasks:**
- [ ] **6.1** E2E test: 2+ users, both outcomes, payout verification
- [ ] **6.2** E2E test: forfeiture (user doesn't reveal)
- [ ] **6.3** E2E test: one-sided market → cancellation
- [ ] **6.4** UI polish: loading states, error handling, timer formatting
- [ ] **6.5** Privacy indicators in UI (🔒 icons, "Your bet is sealed" messages)
- [ ] **6.6** README: project overview, setup instructions, architecture diagram
- [ ] **6.7** Fix any bugs from E2E testing

**Milestone:** Stable, polished, ready for demo

### Phase 7 — Submission (Day 5: Feb 28)
**Goal:** Submitted to DoraHacks before 23:59 UTC

**Tasks:**
- [ ] **7.1** Record demo video (3 min max):
  - Intro: "Prediction markets leak your positions. DarkPool seals them."
  - Show two users committing hidden bets
  - Show market resolving via Pyth oracle
  - Show auto-reveal (positions revealed after outcome known)
  - Show winner claiming payout
  - Show Starkscan: commitments look identical until reveal
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
| Telegram bot: commit + reveal + claim | 5 |
| Auto-reveal (server holds salts) | 5 |
| Keeper: market creation + resolution | 5 |
| Demo video + submission | 7 |

### Stretch Goals (If Time Permits)

| Feature | Complexity | Impact |
|---------|-----------|--------|
| Market factory (multiple concurrent markets) | Medium | Production-like |
| Time-weighted shares (early bird multiplier from Strike) | Low | Fairer incentives |
| Claim All button (batch claims) | Low | QoL |
| Market history with stats | Low | Engagement |

### Out of Scope

Mainnet deploy, tokenomics, AMM/orderbook, cross-chain, AI, mobile app, frontend web UI

---

## 11. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Cairo learning curve (Ayaz new to it) | 🔴 High | Adapt from previous private-strike research; comprehensive Cairo notes in plan |
| Pyth ByteBuffer integration on Starknet | 🔴 High | Test in Phase 2; admin fallback price if Pyth fails |
| starknet.js Poseidon compat with Cairo | 🔴 High | Test hash matching in Phase 1 Task 1.8 BEFORE building more |
| Server wallet security | 🟡 Medium | AES-256-GCM encryption; keys never logged; export option |
| Account deployment gas | 🟡 Medium | Pre-fund deployer; batch deploy if needed |
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
| Interface | Telegram bot (not web) | Matches Strike UX, no wallet extension needed |
| Wallet management | Server-side (starknet.js) | No wallet popups, 1-tap betting, manages salts |
| Auto-reveal | Yes (bot holds salts) | Users don't need to return; privacy intact (after resolution) |
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
