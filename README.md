# DarkPool

**Sealed prediction markets on Starknet** — bet UP/DOWN on BTC/USD with positions and amounts hidden until after oracle resolution.

Built for the [Starknet RE{DEFINE} Hackathon](https://hackathon.starknet.org/) — **Privacy Track**

## The Problem

On-chain prediction markets expose all positions publicly. This enables:

- **Front-running** — whales move odds, others pile on
- **Herd behavior** — bettors copy the visible majority instead of thinking independently
- **Information leakage** — market makers extract alpha from visible order flow

## The Solution

DarkPool uses a **Poseidon commit-reveal scheme** so that both bet direction AND amount are hidden on-chain until after the oracle determines the outcome. Sealed-bid mechanisms produce more honest pricing — DarkPool applies the same principle to prediction markets.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│            React Frontend (Vite + Tailwind + shadcn/ui)     │
│   Wallet: ArgentX / Braavos via starknet-react              │
│   State: contract reads + localStorage for salts            │
└───────────────────────┬─────────────────────────────────────┘
                        │ starknet.js RPC
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌─────────────┐ ┌──────────────┐
│  Keeper Svc  │ │ Starknet    │ │ Pyth Hermes  │
│  (Node.js)   │ │ (Sepolia)   │ │ (BTC/USD)    │
│  - Create    │ │ - Contract  │ └──────────────┘
│  - Resolve   │ │   reads     │
│  - Finalize  │ │ - Tx submit │
└──────┬───────┘ └─────────────┘
       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Starknet Sepolia                          │
│  DarkPool Contract    Pyth Oracle    STRK (ERC-20)          │
│  commit() → reveal() → claim()                              │
└─────────────────────────────────────────────────────────────┘
```

## How It Works

| Phase | Duration | What Happens |
|-------|----------|-------------|
| **Seal** | 2.5 min | Users commit Poseidon hashes + fixed escrow. Bets hidden. |
| **Closed** | 2.5 min | No more bets. Awaiting oracle. |
| **Resolve** | — | Keeper reads BTC/USD from Pyth, sets outcome. |
| **Reveal** | 5 min | Users prove bets by submitting original inputs. Hash verified on-chain. |
| **Finalize** | — | Winners split losing pool (parimutuel). 3% fee on losers. |

**Privacy mechanism:** `commitment = poseidon(direction, amount, salt, user_address)` — everyone deposits the same escrow so all on-chain commitments look identical.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Contracts | Cairo 2.16.0 / Scarb 2.16.0 / Starknet Foundry 0.56.0 |
| Contract libs | OpenZeppelin Cairo 0.20.0, Pyth Starknet |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui |
| Wallet | starknet-react (ArgentX / Braavos) |
| Oracle | Pyth Network (BTC/USD pull oracle) |
| Keeper | Node.js + TypeScript + starknet.js 6.x |
| Token | STRK (ERC-20) |

## Project Structure

```
contracts/     — Cairo smart contracts (50 tests)
frontend/      — React + Tailwind + shadcn/ui web app
keeper/        — Node.js market lifecycle service
scripts/       — Deploy + utility scripts
```

## Quick Start

### Prerequisites

- [Scarb 2.16.0](https://docs.swmansion.com/scarb/) (Cairo build tool)
- [Starknet Foundry 0.56.0](https://github.com/foundry-rs/starknet-foundry) (testing)
- [Node.js 22+](https://nodejs.org/)
- ArgentX or Braavos browser wallet (Starknet Sepolia)

### Contracts

```bash
cd contracts/
scarb build                # Compile Cairo contracts
snforge test               # Run all 50 tests
```

### Frontend

```bash
cd frontend/
npm install
npm run dev                # Dev server at http://localhost:5173
npm run build              # Production build
npm test                   # Playwright E2E tests (21 tests)
```

### Keeper

```bash
cd keeper/
npm install

# Set environment variables
export STARKNET_RPC_URL="https://starknet-sepolia.public.blastapi.io"
export KEEPER_PRIVATE_KEY="0x..."
export KEEPER_ADDRESS="0x..."
export DARKPOOL_ADDRESS="0x00dbb9c226a1d12e1f33a94b56af49b81e7ec9e7f3f405ec1940146c6e5e22ab"

npm run dev
```

## Contract Addresses (Starknet Sepolia)

| Contract | Address |
|----------|---------|
| **DarkPool** | `0x00dbb9c226a1d12e1f33a94b56af49b81e7ec9e7f3f405ec1940146c6e5e22ab` |
| STRK | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |
| Pyth Oracle | `0x07f2b07b6b5365e7ee055bda4c0ecabd867e6d3ee298d73aea32b027667186d6` |

## Key Design Decisions

- **Poseidon hash** over Pedersen — 5x cheaper in Cairo, STARK-native
- **Fixed escrow** — everyone deposits the same amount so commitments look identical on-chain
- **Resolve before reveal** — oracle reads price before users reveal, preventing strategic non-revelation
- **Parimutuel payout** — winners split losing pool proportionally; 3% fee on losing side only
- **Forfeiture** — unrevealed escrows go to the payout pool (disincentivizes griefing)
- **Client-side salt storage** — no backend database needed; export/import for backup

## Screenshots

<!-- Add screenshots here -->
*Coming soon — see demo video*

## Testing

- **Contracts:** 50 unit tests covering commit, resolve, reveal, claim, edge cases
- **Frontend:** 21 Playwright E2E tests covering app loading, market flow, salt management, how-it-works

```bash
# Contracts
cd contracts/ && snforge test

# Frontend
cd frontend/ && npm test
```

## License

MIT
