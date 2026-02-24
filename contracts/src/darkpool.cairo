#[starknet::contract]
pub mod DarkPool {
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess, Map, StorageMapReadAccess, StorageMapWriteAccess};
    use openzeppelin_token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use crate::types::{
        Phase, Side, MarketInfo, Committed, MarketResolved, Revealed, Claimed, Refunded,
        MarketCancelled, MarketFinalized, FeesCollected,
    };
    use crate::hash::verify_commitment;

    // ─── Constants ──────────────────────────────────────────────────────

    const FEE_BPS: u16 = 300; // 3%
    const BPS_DENOMINATOR: u256 = 10_000;
    const MIN_BET: u256 = 1_000_000_000_000_000; // 0.001 STRK (1e15 wei)
    const RESOLUTION_DEADLINE: u64 = 86400; // 24h auto-cancel if not resolved

    // ─── Storage ────────────────────────────────────────────────────────

    #[storage]
    struct Storage {
        // Market config
        market_id: u64,
        phase: Phase,
        strike_price: i64,
        strike_price_expo: i32,
        resolution_price: i64,
        outcome: Side,
        // Timing
        start_time: u64,
        commit_deadline: u64,
        expiry_time: u64,
        reveal_deadline: u64,
        // Escrow
        fixed_escrow: u256,
        bet_token: ContractAddress,
        // Commitments
        commitments: Map<ContractAddress, felt252>,
        has_committed: Map<ContractAddress, bool>,
        commit_count: u32,
        // Reveals
        revealed_direction: Map<ContractAddress, felt252>,
        revealed_amount: Map<ContractAddress, u256>,
        has_revealed: Map<ContractAddress, bool>,
        reveal_count: u32,
        // Pools
        up_pool: u256,
        down_pool: u256,
        total_revealed: u256,
        total_forfeited: u256,
        // Claims
        has_claimed: Map<ContractAddress, bool>,
        // Admin
        owner: ContractAddress,
        fee_collector: ContractAddress,
        protocol_fee_collected: bool,
    }

    // ─── Events ─────────────────────────────────────────────────────────

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Committed: Committed,
        MarketResolved: MarketResolved,
        Revealed: Revealed,
        Claimed: Claimed,
        Refunded: Refunded,
        MarketCancelled: MarketCancelled,
        MarketFinalized: MarketFinalized,
        FeesCollected: FeesCollected,
    }

    // ─── Constructor ────────────────────────────────────────────────────

    #[constructor]
    fn constructor(
        ref self: ContractState,
        market_id: u64,
        bet_token: ContractAddress,
        fixed_escrow: u256,
        strike_price: i64,
        strike_price_expo: i32,
        start_time: u64,
        commit_duration: u64,   // e.g. 150s (2.5 min)
        closed_duration: u64,   // e.g. 150s (2.5 min)
        reveal_duration: u64,   // e.g. 300s (5 min)
        owner: ContractAddress,
        fee_collector: ContractAddress,
    ) {
        self.market_id.write(market_id);
        self.bet_token.write(bet_token);
        self.fixed_escrow.write(fixed_escrow);
        self.strike_price.write(strike_price);
        self.strike_price_expo.write(strike_price_expo);
        self.start_time.write(start_time);
        self.commit_deadline.write(start_time + commit_duration);
        self.expiry_time.write(start_time + commit_duration + closed_duration);
        self.reveal_deadline.write(start_time + commit_duration + closed_duration + reveal_duration);
        self.phase.write(Phase::Committing);
        self.outcome.write(Side::None);
        self.owner.write(owner);
        self.fee_collector.write(fee_collector);
    }

    // ─── Internal helpers ───────────────────────────────────────────────

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Get effective phase based on time (auto-advance for time-based transitions).
        /// Chains transitions: e.g. stored Committing can advance to Closed then Cancelled.
        fn effective_phase(self: @ContractState) -> Phase {
            let stored = self.phase.read();
            let now = get_block_timestamp();

            // Step 1: Committing → Closed (time-based)
            let phase = match stored {
                Phase::Committing => {
                    if now >= self.commit_deadline.read() {
                        Phase::Closed
                    } else {
                        return Phase::Committing;
                    }
                },
                _ => stored,
            };

            // Step 2: From Closed or beyond
            match phase {
                Phase::Closed => {
                    if now >= self.expiry_time.read() + RESOLUTION_DEADLINE {
                        Phase::Cancelled
                    } else {
                        Phase::Closed
                    }
                },
                Phase::Resolved => {
                    // Resolved → Revealing, but check reveal deadline
                    if now >= self.reveal_deadline.read() {
                        Phase::Finalized
                    } else {
                        Phase::Revealing
                    }
                },
                Phase::Revealing => {
                    if now >= self.reveal_deadline.read() {
                        Phase::Finalized
                    } else {
                        Phase::Revealing
                    }
                },
                _ => phase,
            }
        }

        fn assert_owner(self: @ContractState) {
            assert(get_caller_address() == self.owner.read(), 'Only owner');
        }

        fn token(self: @ContractState) -> IERC20Dispatcher {
            IERC20Dispatcher { contract_address: self.bet_token.read() }
        }
    }

    // ─── External implementation ────────────────────────────────────────

    #[abi(embed_v0)]
    impl DarkPoolImpl of crate::interfaces::IDarkPool<ContractState> {
        // ── Commit ──────────────────────────────────────────────────────

        fn commit(ref self: ContractState, commitment_hash: felt252) {
            let phase = self.effective_phase();
            assert(phase == Phase::Committing, 'Not in committing phase');

            let caller = get_caller_address();
            assert(!self.has_committed.read(caller), 'Already committed');
            assert(commitment_hash != 0, 'Invalid commitment hash');

            // Transfer fixed escrow from user
            let escrow = self.fixed_escrow.read();
            let token = self.token();
            let success = token.transfer_from(caller, starknet::get_contract_address(), escrow);
            assert(success, 'Escrow transfer failed');

            // Store commitment
            self.commitments.write(caller, commitment_hash);
            self.has_committed.write(caller, true);
            self.commit_count.write(self.commit_count.read() + 1);

            self.emit(Committed { user: caller, commitment_hash });
        }

        // ── Resolve (owner-only, MVP) ───────────────────────────────────

        fn resolve(ref self: ContractState, price: i64, expo: i32) {
            self.assert_owner();

            let phase = self.effective_phase();
            assert(phase == Phase::Closed, 'Not in closed phase');

            let now = get_block_timestamp();
            assert(now >= self.expiry_time.read(), 'Market not expired');

            // Store resolution price
            self.resolution_price.write(price);

            // Determine outcome by comparing resolution price to strike price
            // Both prices use same expo format from Pyth (e.g. price=9741230, expo=-2 means $97412.30)
            let strike = self.strike_price.read();

            if price > strike {
                self.outcome.write(Side::Up);
            } else if price < strike {
                self.outcome.write(Side::Down);
            } else {
                // Exact tie → cancel
                self.phase.write(Phase::Cancelled);
                self.emit(MarketCancelled { reason: "Exact price tie" });
                return;
            }

            self.phase.write(Phase::Resolved);
            self.emit(MarketResolved {
                outcome: self.outcome.read(),
                resolution_price: price,
                resolver: get_caller_address(),
            });
        }

        // ── Reveal ──────────────────────────────────────────────────────

        fn reveal(ref self: ContractState, direction: felt252, amount: u256, salt: felt252) {
            let phase = self.effective_phase();
            assert(phase == Phase::Revealing, 'Not in revealing phase');

            let caller = get_caller_address();
            assert(self.has_committed.read(caller), 'No commitment found');
            assert(!self.has_revealed.read(caller), 'Already revealed');

            // Verify direction is valid (0=Down, 1=Up)
            assert(direction == 0 || direction == 1, 'Invalid direction');

            // Verify amount is within bounds
            let escrow = self.fixed_escrow.read();
            assert(amount <= escrow, 'Amount exceeds escrow');
            assert(amount >= MIN_BET, 'Amount below minimum');

            // Verify Poseidon hash
            let stored_hash = self.commitments.read(caller);
            // amount must be passed as felt252 for hash computation
            let amount_felt: felt252 = amount.try_into().expect('Amount too large for felt');
            let valid = verify_commitment(stored_hash, direction, amount_felt, salt, caller);
            assert(valid, 'Hash mismatch');

            // Record reveal
            self.revealed_direction.write(caller, direction);
            self.revealed_amount.write(caller, amount);
            self.has_revealed.write(caller, true);
            self.reveal_count.write(self.reveal_count.read() + 1);

            // Add to pools
            if direction == 1 {
                self.up_pool.write(self.up_pool.read() + amount);
            } else {
                self.down_pool.write(self.down_pool.read() + amount);
            }
            self.total_revealed.write(self.total_revealed.read() + amount);

            // Refund excess escrow immediately
            let refund_amount = escrow - amount;
            if refund_amount > 0 {
                let token = self.token();
                let success = token.transfer(caller, refund_amount);
                assert(success, 'Refund transfer failed');
            }

            self.emit(Revealed { user: caller, direction, amount });
        }

        // ── Finalize ────────────────────────────────────────────────────

        fn finalize(ref self: ContractState) {
            let now = get_block_timestamp();
            let phase = self.phase.read();

            // Must be in Resolved or Revealing, and past reveal deadline
            assert(
                phase == Phase::Resolved || phase == Phase::Revealing,
                'Cannot finalize yet',
            );
            assert(now >= self.reveal_deadline.read(), 'Reveal window still open');

            // Calculate forfeited escrows (committed but not revealed)
            let committed = self.commit_count.read();
            let revealed = self.reveal_count.read();
            let unrevealed: u32 = committed - revealed;
            let escrow = self.fixed_escrow.read();
            let forfeited: u256 = escrow * unrevealed.into();
            self.total_forfeited.write(forfeited);

            // Check if market should be cancelled
            let up = self.up_pool.read();
            let down = self.down_pool.read();

            if revealed == 0 {
                // No reveals at all → cancel, but escrows are forfeited (no refund for non-revealers)
                // Actually: if no one revealed, cancel and refund escrows since there's no one to pay
                self.phase.write(Phase::Cancelled);
                self.emit(MarketCancelled { reason: "No reveals" });
                return;
            }

            if up == 0 || down == 0 {
                // One-sided after reveals → cancel, refund revealed amounts
                self.phase.write(Phase::Cancelled);
                self.emit(MarketCancelled { reason: "One-sided market" });
                return;
            }

            self.phase.write(Phase::Finalized);
            self.emit(MarketFinalized { total_forfeited: forfeited });
        }

        // ── Claim ───────────────────────────────────────────────────────

        fn claim(ref self: ContractState) {
            // Must read stored phase — finalize() must have been explicitly called
            // to compute forfeitures and check one-sided markets
            let phase = self.phase.read();
            assert(phase == Phase::Finalized, 'Not finalized');

            let caller = get_caller_address();
            assert(self.has_revealed.read(caller), 'Not revealed');
            assert(!self.has_claimed.read(caller), 'Already claimed');

            // Check if user is on winning side
            let outcome = self.outcome.read();
            let user_direction = self.revealed_direction.read(caller);

            let on_winning_side = match outcome {
                Side::Up => user_direction == 1,
                Side::Down => user_direction == 0,
                Side::None => false,
            };

            if !on_winning_side {
                // Losers get nothing — their bet amount stays in the pool
                self.has_claimed.write(caller, true);
                self.emit(Claimed { user: caller, payout: 0 });
                return;
            }

            // Calculate parimutuel payout
            let up = self.up_pool.read();
            let down = self.down_pool.read();
            let forfeited = self.total_forfeited.read();

            let (winning_pool, losing_pool) = if outcome == Side::Up {
                (up, down)
            } else {
                (down, up)
            };

            // Fee from losing side only
            let fee: u256 = (losing_pool * FEE_BPS.into()) / BPS_DENOMINATOR;

            // Total payout pool = winning + losing - fee + forfeited
            let payout_pool = winning_pool + losing_pool - fee + forfeited;

            // User's share
            let user_bet = self.revealed_amount.read(caller);
            let payout = (user_bet * payout_pool) / winning_pool;

            self.has_claimed.write(caller, true);

            // Transfer payout
            let token = self.token();
            let success = token.transfer(caller, payout);
            assert(success, 'Payout transfer failed');

            self.emit(Claimed { user: caller, payout });
        }

        // ── Refund (cancelled markets) ──────────────────────────────────

        fn refund(ref self: ContractState) {
            let phase = self.effective_phase();
            assert(phase == Phase::Cancelled, 'Not cancelled');

            let caller = get_caller_address();
            assert(!self.has_claimed.read(caller), 'Already refunded');

            let mut refund_amount: u256 = 0;

            if self.has_revealed.read(caller) {
                // Revealed users get back their revealed amount
                refund_amount = self.revealed_amount.read(caller);
            } else if self.has_committed.read(caller) {
                // Committed but unrevealed — refund full escrow (market was cancelled, not finalized)
                refund_amount = self.fixed_escrow.read();
            }

            assert(refund_amount > 0, 'Nothing to refund');

            self.has_claimed.write(caller, true);

            let token = self.token();
            let success = token.transfer(caller, refund_amount);
            assert(success, 'Refund transfer failed');

            self.emit(Refunded { user: caller, amount: refund_amount });
        }

        // ── Emergency Cancel (owner only) ───────────────────────────────

        fn emergency_cancel(ref self: ContractState) {
            self.assert_owner();

            let phase = self.phase.read();
            assert(phase != Phase::Finalized, 'Already finalized');
            assert(phase != Phase::Cancelled, 'Already cancelled');

            self.phase.write(Phase::Cancelled);
            self.emit(MarketCancelled { reason: "Emergency cancellation" });
        }

        // ── Collect Fees ────────────────────────────────────────────────

        fn collect_fees(ref self: ContractState) {
            let phase = self.phase.read();
            assert(phase == Phase::Finalized, 'Not finalized');
            assert(!self.protocol_fee_collected.read(), 'Fees already collected');

            let outcome = self.outcome.read();
            let up = self.up_pool.read();
            let down = self.down_pool.read();

            let losing_pool = if outcome == Side::Up {
                down
            } else {
                up
            };

            let fee: u256 = (losing_pool * FEE_BPS.into()) / BPS_DENOMINATOR;
            assert(fee > 0, 'No fees to collect');

            self.protocol_fee_collected.write(true);

            let collector = self.fee_collector.read();
            let token = self.token();
            let success = token.transfer(collector, fee);
            assert(success, 'Fee transfer failed');

            self.emit(FeesCollected { amount: fee, collector });
        }

        // ── View Functions ──────────────────────────────────────────────

        fn get_market_info(self: @ContractState) -> MarketInfo {
            MarketInfo {
                market_id: self.market_id.read(),
                phase: self.effective_phase(),
                strike_price: self.strike_price.read(),
                strike_price_expo: self.strike_price_expo.read(),
                resolution_price: self.resolution_price.read(),
                outcome: self.outcome.read(),
                start_time: self.start_time.read(),
                commit_deadline: self.commit_deadline.read(),
                expiry_time: self.expiry_time.read(),
                reveal_deadline: self.reveal_deadline.read(),
                fixed_escrow: self.fixed_escrow.read(),
                commit_count: self.commit_count.read(),
                reveal_count: self.reveal_count.read(),
                up_pool: self.up_pool.read(),
                down_pool: self.down_pool.read(),
                total_forfeited: self.total_forfeited.read(),
            }
        }

        fn get_phase(self: @ContractState) -> Phase {
            self.effective_phase()
        }

        fn get_commitment(self: @ContractState, user: ContractAddress) -> felt252 {
            self.commitments.read(user)
        }

        fn has_user_committed(self: @ContractState, user: ContractAddress) -> bool {
            self.has_committed.read(user)
        }

        fn has_user_revealed(self: @ContractState, user: ContractAddress) -> bool {
            self.has_revealed.read(user)
        }

        fn has_user_claimed(self: @ContractState, user: ContractAddress) -> bool {
            self.has_claimed.read(user)
        }

        fn get_pool_sizes(self: @ContractState) -> (u256, u256, u256) {
            (self.up_pool.read(), self.down_pool.read(), self.total_revealed.read())
        }
    }
}
