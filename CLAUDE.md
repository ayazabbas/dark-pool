# CLAUDE.md — Development Guide for DarkPool

## Project Overview
DarkPool is a sealed prediction market on Starknet. Users bet UP/DOWN on BTC/USD price using Poseidon commit-reveal for privacy. Both bet direction AND amount are hidden until after oracle resolution.

**Read `PLAN.md` for full architecture, contract design, and phase breakdown.**

## Tech Stack
- **Contracts:** Cairo 2.16.0, Scarb 2.16.0, Starknet Foundry (snforge 0.56.0)
- **Contract libs:** OpenZeppelin Cairo 0.20.0, Pyth Starknet
- **Frontend:** React 19 + TypeScript + Vite, Tailwind CSS 4, shadcn/ui, starknet-react
- **Keeper:** Node.js + TypeScript + starknet.js 6.x
- **Oracle:** Pyth Network (pull oracle on Starknet)
- **Token:** STRK (ERC-20)

## Project Structure
```
contracts/     — Cairo smart contracts (Scarb project)
frontend/      — React + Tailwind + shadcn/ui web app
keeper/        — Node.js market lifecycle service
scripts/       — Deploy + utility scripts
```

## Contract Commands
```bash
cd contracts/
scarb build                    # Compile
snforge test                   # Run tests
snforge test -f test_name      # Run specific test
sncast declare ...             # Declare contract class
sncast deploy ...              # Deploy instance
```

## Frontend Commands
```bash
cd frontend/
npm install                    # Install deps
npm run dev                    # Dev server (Vite)
npm run build                  # Production build
```

## Keeper Commands
```bash
cd keeper/
npm install
npm run dev                    # Run keeper with ts-node
```

## Key Addresses (Starknet Sepolia)
- STRK: `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
- ETH: `0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7`
- Pyth: `0x07f2b07b6b5365e7ee055bda4c0ecabd867e6d3ee298d73aea32b027667186d6`
- BTC/USD Feed: `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`

## Critical Design Decisions
1. **Poseidon hash:** `poseidon(direction, amount, salt, user_address)` — must match `starknet.js hash.computePoseidonHashOnElements()`
2. **Fixed escrow:** Everyone deposits same amount (hides actual bet size)
3. **Phase ordering:** Commit → Close → Resolve → Reveal → Finalize (resolution BEFORE reveals)
4. **Parimutuel payout:** Winners split losing pool proportionally; 3% fee on losing side only
5. **Forfeiture:** Unrevealed escrows go to payout pool

## Reference Code
- Strike (Solidity original): `~/dev/strike/` — reference for payout math, keeper patterns
- Previous Cairo research: `~/dev/starknet-private-strike/PLAN.md` — Poseidon patterns, pitfalls

## Pyth Integration Notes (Starknet-Specific)
- Uses ByteBuffer format (not bytes[])
- Fees paid in STRK via ERC-20 approve (no native token passing)
- Flow: get_update_fee() → approve STRK → update_price_feeds() → get_price_no_older_than()
- Client-side: `@pythnetwork/pyth-starknet-js` for VAA → ByteBuffer conversion

## Testing
- Use snforge for contract tests
- Mock ERC-20 token for STRK in tests (OpenZeppelin ERC20Component)
- No on-chain Pyth — resolve() is owner-only, accepts (price: i64, expo: i32) directly
- Test Poseidon hash compatibility between Cairo and starknet.js (CRITICAL)
- 50 tests covering all phases, edge cases, and security invariants

## Contract Gotchas (Discovered During Implementation)
1. **effective_phase() must chain transitions:** Stored phase Committing can advance to Closed then to Cancelled (24h timeout). Without chaining, auto-cancel after resolution deadline was broken.
2. **claim() reads stored phase, NOT effective_phase():** finalize() must be explicitly called before claims. Otherwise forfeiture calculation and one-sided market detection are skipped. This is intentional — the keeper must call finalize().
3. **Resolved maps to Revealing OR Finalized:** After resolve() stores Phase::Resolved, effective_phase() returns Revealing if before deadline, Finalized if after. This correctly blocks late reveals.
4. **amount in Poseidon hash is felt252, not u256:** The commitment hash uses `amount: felt252`. During reveal, `amount: u256` is converted via `try_into()`. This MUST match the client-side `hash.computePoseidonHashOnElements()` which also uses felt252.
5. **MIN_BET enforced at reveal, not commit:** Since amount is hidden in the hash, we can only validate it when the user reveals.
6. **Refund logic differs by cancel path:** Emergency cancel → unrevealed get full escrow back. One-sided cancel (via finalize) → revealed get their revealed_amount back. No-reveals cancel → committed get full escrow.
7. **`#[feature("deprecated-starknet-consts")]`** needed for `contract_address_const` in tests.

## Frontend Notes
- starknet-react for wallet connection (ArgentX/Braavos)
- Salts stored in localStorage with export/import backup
- Dark theme, "DarkPool" branding
- Single-page app: market view, bet panel, my bets, how it works
- Auto-reveal if tab is open when phase changes to Revealing
