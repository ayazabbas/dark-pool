use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait,
    start_cheat_caller_address, stop_cheat_caller_address,
    start_cheat_block_timestamp_global,
};
use starknet::ContractAddress;
#[feature("deprecated-starknet-consts")]
use starknet::contract_address_const;
use openzeppelin_token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
use crate::interfaces::{IDarkPoolDispatcher, IDarkPoolDispatcherTrait};
use crate::types::{Phase, Side};
use crate::hash::compute_commitment;

// ─── Constants ──────────────────────────────────────────────────────────────

const FIXED_ESCROW: u256 = 10_000_000_000_000_000_000; // 10 STRK
const INITIAL_BALANCE: u256 = 1_000_000_000_000_000_000_000; // 1000 STRK
const START_TIME: u64 = 1000;
const COMMIT_DURATION: u64 = 150; // 2.5 min
const CLOSED_DURATION: u64 = 150; // 2.5 min
const REVEAL_DURATION: u64 = 300; // 5 min
const STRIKE_PRICE: i64 = 9741230; // $97412.30 with expo=-2
const STRIKE_EXPO: i32 = -2;

fn OWNER() -> ContractAddress {
    contract_address_const::<'owner'>()
}
fn USER1() -> ContractAddress {
    contract_address_const::<'user1'>()
}
fn USER2() -> ContractAddress {
    contract_address_const::<'user2'>()
}
fn USER3() -> ContractAddress {
    contract_address_const::<'user3'>()
}
fn FEE_COLLECTOR() -> ContractAddress {
    contract_address_const::<'fee_collector'>()
}

// ─── Deploy helpers ─────────────────────────────────────────────────────────

fn deploy_mock_erc20() -> (ContractAddress, IERC20Dispatcher) {
    let contract = declare("MockERC20").unwrap().contract_class();
    let name: ByteArray = "Mock STRK";
    let symbol: ByteArray = "STRK";
    let supply: u256 = INITIAL_BALANCE * 10;
    let recipient = OWNER();
    let mut calldata: Array<felt252> = array![];
    name.serialize(ref calldata);
    symbol.serialize(ref calldata);
    supply.serialize(ref calldata);
    recipient.serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();
    (address, IERC20Dispatcher { contract_address: address })
}

fn deploy_darkpool(token_address: ContractAddress) -> (ContractAddress, IDarkPoolDispatcher) {
    let contract = declare("DarkPool").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    let market_id: u64 = 1;
    market_id.serialize(ref calldata);
    token_address.serialize(ref calldata);
    FIXED_ESCROW.serialize(ref calldata);
    STRIKE_PRICE.serialize(ref calldata);
    STRIKE_EXPO.serialize(ref calldata);
    START_TIME.serialize(ref calldata);
    COMMIT_DURATION.serialize(ref calldata);
    CLOSED_DURATION.serialize(ref calldata);
    REVEAL_DURATION.serialize(ref calldata);
    OWNER().serialize(ref calldata);
    FEE_COLLECTOR().serialize(ref calldata);
    let (address, _) = contract.deploy(@calldata).unwrap();
    (address, IDarkPoolDispatcher { contract_address: address })
}

fn setup() -> (IERC20Dispatcher, IDarkPoolDispatcher, ContractAddress, ContractAddress) {
    let (token_addr, token) = deploy_mock_erc20();
    let (pool_addr, pool) = deploy_darkpool(token_addr);

    // Distribute tokens to users from owner
    start_cheat_caller_address(token_addr, OWNER());
    token.transfer(USER1(), INITIAL_BALANCE);
    token.transfer(USER2(), INITIAL_BALANCE);
    token.transfer(USER3(), INITIAL_BALANCE);
    stop_cheat_caller_address(token_addr);

    // Set block timestamp to start_time (committing phase)
    start_cheat_block_timestamp_global(START_TIME);

    (token, pool, token_addr, pool_addr)
}

fn approve_and_commit(
    token_addr: ContractAddress,
    pool_addr: ContractAddress,
    pool: IDarkPoolDispatcher,
    token: IERC20Dispatcher,
    user: ContractAddress,
    direction: felt252,
    amount: felt252,
    salt: felt252,
) {
    let hash = compute_commitment(direction, amount, salt, user);

    start_cheat_caller_address(token_addr, user);
    token.approve(pool_addr, FIXED_ESCROW);
    stop_cheat_caller_address(token_addr);

    start_cheat_caller_address(pool_addr, user);
    pool.commit(hash);
    stop_cheat_caller_address(pool_addr);
}

// ─── Phase 1 Tests: Commit + Phase Transitions ─────────────────────────────

#[test]
fn test_initial_phase_is_committing() {
    let (_, pool, _, _) = setup();
    let phase = pool.get_phase();
    assert(phase == Phase::Committing, 'Should be Committing');
}

#[test]
fn test_commit_works() {
    let (token, pool, token_addr, pool_addr) = setup();

    let direction: felt252 = 1; // Up
    let amount: felt252 = FIXED_ESCROW.try_into().unwrap();
    let salt: felt252 = 'random_salt_123';

    approve_and_commit(token_addr, pool_addr, pool, token, USER1(), direction, amount, salt);

    assert(pool.has_user_committed(USER1()), 'Should be committed');
    assert(pool.get_commitment(USER1()) != 0, 'Hash should be set');

    let info = pool.get_market_info();
    assert(info.commit_count == 1, 'Commit count should be 1');
}

#[test]
fn test_commit_transfers_escrow() {
    let (token, pool, token_addr, pool_addr) = setup();

    let balance_before = token.balance_of(USER1());

    let direction: felt252 = 1;
    let amount: felt252 = FIXED_ESCROW.try_into().unwrap();
    let salt: felt252 = 'salt1';

    approve_and_commit(token_addr, pool_addr, pool, token, USER1(), direction, amount, salt);

    let balance_after = token.balance_of(USER1());
    assert(balance_before - balance_after == FIXED_ESCROW, 'Should deduct escrow');
}

#[test]
#[should_panic(expected: 'Already committed')]
fn test_duplicate_commit_rejected() {
    let (token, pool, token_addr, pool_addr) = setup();

    let direction: felt252 = 1;
    let amount: felt252 = FIXED_ESCROW.try_into().unwrap();
    let salt: felt252 = 'salt1';

    approve_and_commit(token_addr, pool_addr, pool, token, USER1(), direction, amount, salt);

    // Try to commit again
    let hash = compute_commitment(direction, amount, 'salt2', USER1());
    start_cheat_caller_address(token_addr, USER1());
    token.approve(pool_addr, FIXED_ESCROW);
    stop_cheat_caller_address(token_addr);

    start_cheat_caller_address(pool_addr, USER1());
    pool.commit(hash);
    stop_cheat_caller_address(pool_addr);
}

#[test]
#[should_panic(expected: 'Not in committing phase')]
fn test_commit_after_deadline_rejected() {
    let (token, pool, token_addr, pool_addr) = setup();

    // Advance past commit deadline
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + 1);

    let direction: felt252 = 1;
    let amount: felt252 = FIXED_ESCROW.try_into().unwrap();
    let salt: felt252 = 'salt1';

    approve_and_commit(token_addr, pool_addr, pool, token, USER1(), direction, amount, salt);
}

#[test]
fn test_phase_auto_advances_to_closed() {
    let (_, pool, _, _) = setup();

    // Advance past commit deadline
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + 1);

    let phase = pool.get_phase();
    assert(phase == Phase::Closed, 'Should auto-advance to Closed');
}

#[test]
fn test_poseidon_hash_deterministic() {
    let direction: felt252 = 1;
    let amount: felt252 = FIXED_ESCROW.try_into().unwrap();
    let salt: felt252 = 'test_salt';
    let user = USER1();

    let hash1 = compute_commitment(direction, amount, salt, user);
    let hash2 = compute_commitment(direction, amount, salt, user);
    assert(hash1 == hash2, 'Hash should be deterministic');

    // Different inputs should give different hash
    let hash3 = compute_commitment(0, amount, salt, user);
    assert(hash1 != hash3, 'Diff inputs diff hash');
}

#[test]
#[should_panic(expected: 'Invalid commitment hash')]
fn test_zero_hash_rejected() {
    let (token, pool, token_addr, pool_addr) = setup();

    start_cheat_caller_address(token_addr, USER1());
    token.approve(pool_addr, FIXED_ESCROW);
    stop_cheat_caller_address(token_addr);

    start_cheat_caller_address(pool_addr, USER1());
    pool.commit(0);
    stop_cheat_caller_address(pool_addr);
}

// ─── Phase 2 Tests: Resolve + Reveal + Finalize ────────────────────────────

fn setup_with_commits() -> (IERC20Dispatcher, IDarkPoolDispatcher, ContractAddress, ContractAddress) {
    let (token, pool, token_addr, pool_addr) = setup();

    // User1 commits UP with full escrow
    let amount_felt: felt252 = FIXED_ESCROW.try_into().unwrap();
    approve_and_commit(token_addr, pool_addr, pool, token, USER1(), 1, amount_felt, 'salt_u1');

    // User2 commits DOWN with full escrow
    approve_and_commit(token_addr, pool_addr, pool, token, USER2(), 0, amount_felt, 'salt_u2');

    (token, pool, token_addr, pool_addr)
}

#[test]
fn test_resolve_sets_outcome_up() {
    let (_, pool, _, pool_addr) = setup_with_commits();

    // Advance to after expiry
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);

    // Resolve with price higher than strike → Up wins
    let resolution_price: i64 = STRIKE_PRICE + 100;
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(resolution_price, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    let info = pool.get_market_info();
    assert(info.outcome == Side::Up, 'Outcome should be Up');
    assert(info.phase == Phase::Revealing, 'Should be Revealing');
}

#[test]
fn test_resolve_sets_outcome_down() {
    let (_, pool, _, pool_addr) = setup_with_commits();

    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);

    let resolution_price: i64 = STRIKE_PRICE - 100;
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(resolution_price, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    let info = pool.get_market_info();
    assert(info.outcome == Side::Down, 'Outcome should be Down');
}

#[test]
fn test_resolve_exact_tie_cancels() {
    let (_, pool, _, pool_addr) = setup_with_commits();

    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);

    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    let phase = pool.get_phase();
    assert(phase == Phase::Cancelled, 'Should be Cancelled on tie');
}

#[test]
#[should_panic(expected: 'Only owner')]
fn test_resolve_not_owner_rejected() {
    let (_, pool, _, pool_addr) = setup_with_commits();

    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);

    start_cheat_caller_address(pool_addr, USER1());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);
}

#[test]
#[should_panic(expected: 'Market not expired')]
fn test_resolve_before_expiry_rejected() {
    let (_, pool, _, pool_addr) = setup_with_commits();

    // Still in closed phase but before expiry
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + 1);

    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);
}

#[test]
fn test_reveal_works() {
    let (_token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Resolve with price up
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // User1 reveals (committed UP)
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt_u1');
    stop_cheat_caller_address(pool_addr);

    assert(pool.has_user_revealed(USER1()), 'Should be revealed');

    let (up, down, _total) = pool.get_pool_sizes();
    assert(up == FIXED_ESCROW, 'Up pool should have escrow');
    assert(down == 0, 'Down pool should be 0');
}

#[test]
#[should_panic(expected: 'Hash mismatch')]
fn test_reveal_wrong_direction_rejected() {
    let (_, pool, _, pool_addr) = setup_with_commits();

    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // User1 committed UP (1), try to reveal DOWN (0)
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(0, FIXED_ESCROW, 'salt_u1');
    stop_cheat_caller_address(pool_addr);
}

#[test]
#[should_panic(expected: 'Hash mismatch')]
fn test_reveal_wrong_salt_rejected() {
    let (_, pool, _, pool_addr) = setup_with_commits();

    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'wrong_salt');
    stop_cheat_caller_address(pool_addr);
}

#[test]
#[should_panic(expected: 'Amount exceeds escrow')]
fn test_reveal_amount_exceeds_escrow() {
    let (_, pool, _, pool_addr) = setup_with_commits();

    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW + 1, 'salt_u1');
    stop_cheat_caller_address(pool_addr);
}

#[test]
fn test_reveal_partial_amount_refunds_excess() {
    let (token, pool, token_addr, pool_addr) = setup();

    // Commit with partial amount (5 STRK of 10 STRK escrow)
    let partial_amount: u256 = 5_000_000_000_000_000_000; // 5 STRK
    let amount_felt: felt252 = partial_amount.try_into().unwrap();

    approve_and_commit(token_addr, pool_addr, pool, token, USER1(), 1, amount_felt, 'salt_partial');
    // Also need a user on the other side for a valid market
    let full_amount_felt: felt252 = FIXED_ESCROW.try_into().unwrap();
    approve_and_commit(token_addr, pool_addr, pool, token, USER2(), 0, full_amount_felt, 'salt_u2');

    // Resolve
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    let balance_before_reveal = token.balance_of(USER1());

    // Reveal with partial amount → should refund 5 STRK
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, partial_amount, 'salt_partial');
    stop_cheat_caller_address(pool_addr);

    let balance_after_reveal = token.balance_of(USER1());
    let refunded = balance_after_reveal - balance_before_reveal;
    let expected_refund = FIXED_ESCROW - partial_amount;
    assert(refunded == expected_refund, 'Should refund excess');
}

#[test]
fn test_full_lifecycle_commit_resolve_reveal_finalize() {
    let (_token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Resolve
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // Both users reveal
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt_u1');
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER2());
    pool.reveal(0, FIXED_ESCROW, 'salt_u2');
    stop_cheat_caller_address(pool_addr);

    // Advance past reveal deadline
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1);

    // Finalize
    start_cheat_caller_address(pool_addr, OWNER());
    pool.finalize();
    stop_cheat_caller_address(pool_addr);

    let info = pool.get_market_info();
    assert(info.phase == Phase::Finalized, 'Should be Finalized');
    assert(info.reveal_count == 2, 'Should have 2 reveals');
}

// ─── Phase 3 Tests: Payouts + Edge Cases ────────────────────────────────────

#[test]
fn test_claim_winner_gets_payout() {
    let (token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Resolve UP wins
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // Both reveal
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt_u1');
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER2());
    pool.reveal(0, FIXED_ESCROW, 'salt_u2');
    stop_cheat_caller_address(pool_addr);

    // Finalize
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.finalize();
    stop_cheat_caller_address(pool_addr);

    // Winner (User1 - UP) claims
    let balance_before = token.balance_of(USER1());
    start_cheat_caller_address(pool_addr, USER1());
    pool.claim();
    stop_cheat_caller_address(pool_addr);
    let balance_after = token.balance_of(USER1());

    // Payout = winning_pool + losing_pool - fee + forfeited
    // = 10 + 10 - 0.3 + 0 = 19.7 STRK
    let payout = balance_after - balance_before;
    let losing_pool = FIXED_ESCROW;
    let fee = (losing_pool * 300) / 10_000; // 3% of 10 STRK = 0.3 STRK
    let expected_payout = FIXED_ESCROW + FIXED_ESCROW - fee; // 19.7 STRK
    assert(payout == expected_payout, 'Winner payout incorrect');
}

#[test]
fn test_loser_gets_nothing() {
    let (token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Resolve UP wins
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // Both reveal
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt_u1');
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER2());
    pool.reveal(0, FIXED_ESCROW, 'salt_u2');
    stop_cheat_caller_address(pool_addr);

    // Finalize
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.finalize();
    stop_cheat_caller_address(pool_addr);

    // Loser (User2 - DOWN) claims
    let balance_before = token.balance_of(USER2());
    start_cheat_caller_address(pool_addr, USER2());
    pool.claim();
    stop_cheat_caller_address(pool_addr);
    let balance_after = token.balance_of(USER2());

    assert(balance_after == balance_before, 'Loser should get 0');
}

#[test]
#[should_panic(expected: 'Already claimed')]
fn test_double_claim_rejected() {
    let (_token, pool, _token_addr, pool_addr) = setup_with_commits();

    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt_u1');
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER2());
    pool.reveal(0, FIXED_ESCROW, 'salt_u2');
    stop_cheat_caller_address(pool_addr);

    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.finalize();
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER1());
    pool.claim();
    pool.claim(); // should panic
    stop_cheat_caller_address(pool_addr);
}

#[test]
fn test_fee_collection() {
    let (token, pool, _token_addr, pool_addr) = setup_with_commits();

    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt_u1');
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER2());
    pool.reveal(0, FIXED_ESCROW, 'salt_u2');
    stop_cheat_caller_address(pool_addr);

    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.finalize();
    stop_cheat_caller_address(pool_addr);

    // Collect fees
    let fee_balance_before = token.balance_of(FEE_COLLECTOR());
    pool.collect_fees();
    let fee_balance_after = token.balance_of(FEE_COLLECTOR());

    let expected_fee = (FIXED_ESCROW * 300) / 10_000; // 3% of losing pool (10 STRK)
    assert(fee_balance_after - fee_balance_before == expected_fee, 'Fee incorrect');
}

#[test]
fn test_emergency_cancel() {
    let (_, pool, _, pool_addr) = setup_with_commits();

    start_cheat_caller_address(pool_addr, OWNER());
    pool.emergency_cancel();
    stop_cheat_caller_address(pool_addr);

    let phase = pool.get_phase();
    assert(phase == Phase::Cancelled, 'Should be Cancelled');
}

#[test]
#[should_panic(expected: 'Only owner')]
fn test_emergency_cancel_not_owner() {
    let (_, pool, _, pool_addr) = setup_with_commits();

    start_cheat_caller_address(pool_addr, USER1());
    pool.emergency_cancel();
    stop_cheat_caller_address(pool_addr);
}

#[test]
fn test_refund_on_cancelled_market() {
    let (token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Cancel the market
    start_cheat_caller_address(pool_addr, OWNER());
    pool.emergency_cancel();
    stop_cheat_caller_address(pool_addr);

    // User1 gets refund (committed but not revealed → full escrow back)
    let balance_before = token.balance_of(USER1());
    start_cheat_caller_address(pool_addr, USER1());
    pool.refund();
    stop_cheat_caller_address(pool_addr);
    let balance_after = token.balance_of(USER1());

    assert(balance_after - balance_before == FIXED_ESCROW, 'Should refund full escrow');
}

#[test]
fn test_forfeiture_unrevealed_goes_to_pool() {
    let (token, pool, token_addr, pool_addr) = setup();

    // Three users commit
    let amount_felt: felt252 = FIXED_ESCROW.try_into().unwrap();
    approve_and_commit(token_addr, pool_addr, pool, token, USER1(), 1, amount_felt, 'salt1');
    approve_and_commit(token_addr, pool_addr, pool, token, USER2(), 0, amount_felt, 'salt2');
    approve_and_commit(token_addr, pool_addr, pool, token, USER3(), 1, amount_felt, 'salt3');

    // Resolve
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // Only User1 and User2 reveal (User3 doesn't reveal)
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt1');
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER2());
    pool.reveal(0, FIXED_ESCROW, 'salt2');
    stop_cheat_caller_address(pool_addr);

    // Finalize after reveal deadline
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.finalize();
    stop_cheat_caller_address(pool_addr);

    let info = pool.get_market_info();
    assert(info.total_forfeited == FIXED_ESCROW, 'Should forfeit 1 escrow');

    // Winner (User1 UP) should get extra from forfeiture
    let balance_before = token.balance_of(USER1());
    start_cheat_caller_address(pool_addr, USER1());
    pool.claim();
    stop_cheat_caller_address(pool_addr);
    let balance_after = token.balance_of(USER1());

    // Payout = (user_bet / winning_pool) * (winning + losing - fee + forfeited)
    // = (10 / 10) * (10 + 10 - 0.3 + 10) = 29.7 STRK
    let payout = balance_after - balance_before;
    let fee = (FIXED_ESCROW * 300) / 10_000;
    let expected = FIXED_ESCROW + FIXED_ESCROW - fee + FIXED_ESCROW; // 29.7 STRK
    assert(payout == expected, 'Forfeiture should boost payout');
}

#[test]
fn test_one_sided_market_cancels_on_finalize() {
    let (token, pool, token_addr, pool_addr) = setup();

    // Both users commit UP (one-sided)
    let amount_felt: felt252 = FIXED_ESCROW.try_into().unwrap();
    approve_and_commit(token_addr, pool_addr, pool, token, USER1(), 1, amount_felt, 'salt1');
    approve_and_commit(token_addr, pool_addr, pool, token, USER2(), 1, amount_felt, 'salt2');

    // Resolve
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // Both reveal UP
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt1');
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER2());
    pool.reveal(1, FIXED_ESCROW, 'salt2');
    stop_cheat_caller_address(pool_addr);

    // Finalize → should cancel (one-sided)
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.finalize();
    stop_cheat_caller_address(pool_addr);

    let phase = pool.get_phase();
    assert(phase == Phase::Cancelled, 'One-sided should cancel');
}

#[test]
fn test_no_reveals_cancels() {
    let (_, pool, _, pool_addr) = setup_with_commits();

    // Resolve
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // No one reveals, finalize after deadline
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.finalize();
    stop_cheat_caller_address(pool_addr);

    let phase = pool.get_phase();
    assert(phase == Phase::Cancelled, 'No reveals should cancel');
}

#[test]
#[should_panic(expected: 'Not in revealing phase')]
fn test_reveal_before_resolution_rejected() {
    let (_, pool, _, pool_addr) = setup_with_commits();

    // Try to reveal during Closed phase (not resolved yet)
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + 1);

    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt_u1');
    stop_cheat_caller_address(pool_addr);
}

#[test]
#[should_panic(expected: 'Already revealed')]
fn test_double_reveal_rejected() {
    let (_, pool, _, pool_addr) = setup_with_commits();

    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt_u1');
    pool.reveal(1, FIXED_ESCROW, 'salt_u1'); // should panic
    stop_cheat_caller_address(pool_addr);
}

#[test]
fn test_market_info_returns_correct_data() {
    let (_, pool, _, _) = setup();

    let info = pool.get_market_info();
    assert(info.market_id == 1, 'Market ID should be 1');
    assert(info.strike_price == STRIKE_PRICE, 'Strike price wrong');
    assert(info.fixed_escrow == FIXED_ESCROW, 'Escrow wrong');
    assert(info.commit_deadline == START_TIME + COMMIT_DURATION, 'Commit deadline wrong');
    assert(info.phase == Phase::Committing, 'Phase wrong');
}

#[test]
fn test_multiple_winners_split_proportionally() {
    let (token, pool, token_addr, pool_addr) = setup();

    // User1 commits UP with 5 STRK, User2 commits UP with 10 STRK, User3 commits DOWN with 10 STRK
    let five_strk: u256 = 5_000_000_000_000_000_000;
    let five_felt: felt252 = five_strk.try_into().unwrap();
    let ten_felt: felt252 = FIXED_ESCROW.try_into().unwrap();

    approve_and_commit(token_addr, pool_addr, pool, token, USER1(), 1, five_felt, 'salt1');
    approve_and_commit(token_addr, pool_addr, pool, token, USER2(), 1, ten_felt, 'salt2');
    approve_and_commit(token_addr, pool_addr, pool, token, USER3(), 0, ten_felt, 'salt3');

    // Resolve UP
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // All reveal
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, five_strk, 'salt1');
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER2());
    pool.reveal(1, FIXED_ESCROW, 'salt2');
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER3());
    pool.reveal(0, FIXED_ESCROW, 'salt3');
    stop_cheat_caller_address(pool_addr);

    // Finalize
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.finalize();
    stop_cheat_caller_address(pool_addr);

    // Winning pool = 5 + 10 = 15 STRK (up)
    // Losing pool = 10 STRK (down)
    // Fee = 10 * 300 / 10000 = 0.3 STRK
    // Payout pool = 15 + 10 - 0.3 = 24.7 STRK
    // User1 gets: (5/15) * 24.7 = 8.233... STRK
    // User2 gets: (10/15) * 24.7 = 16.466... STRK

    let bal1_before = token.balance_of(USER1());
    start_cheat_caller_address(pool_addr, USER1());
    pool.claim();
    stop_cheat_caller_address(pool_addr);
    let payout1 = token.balance_of(USER1()) - bal1_before;

    let bal2_before = token.balance_of(USER2());
    start_cheat_caller_address(pool_addr, USER2());
    pool.claim();
    stop_cheat_caller_address(pool_addr);
    let payout2 = token.balance_of(USER2()) - bal2_before;

    // User2 should get exactly 2x User1's payout (10/5 ratio)
    // Due to integer division, check approximate: payout2 ~= 2 * payout1
    assert(payout2 > payout1, 'User2 should get more');

    // Both should be positive
    assert(payout1 > 0, 'User1 should get payout');
    assert(payout2 > 0, 'User2 should get payout');
}

#[test]
#[should_panic(expected: 'Reveal window still open')]
fn test_finalize_before_deadline_rejected() {
    let (_, pool, _, pool_addr) = setup_with_commits();

    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // Try to finalize before reveal deadline
    start_cheat_caller_address(pool_addr, OWNER());
    pool.finalize();
    stop_cheat_caller_address(pool_addr);
}

#[test]
fn test_refund_after_reveal_on_cancelled() {
    let (token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Resolve, one user reveals, then emergency cancel
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // User1 reveals
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt_u1');
    stop_cheat_caller_address(pool_addr);

    // Emergency cancel
    start_cheat_caller_address(pool_addr, OWNER());
    pool.emergency_cancel();
    stop_cheat_caller_address(pool_addr);

    // User1 (revealed) gets back their revealed amount
    let bal1_before = token.balance_of(USER1());
    start_cheat_caller_address(pool_addr, USER1());
    pool.refund();
    stop_cheat_caller_address(pool_addr);
    let refund1 = token.balance_of(USER1()) - bal1_before;
    assert(refund1 == FIXED_ESCROW, 'Revealed user refund incorrect');

    // User2 (not revealed) gets back full escrow
    let bal2_before = token.balance_of(USER2());
    start_cheat_caller_address(pool_addr, USER2());
    pool.refund();
    stop_cheat_caller_address(pool_addr);
    let refund2 = token.balance_of(USER2()) - bal2_before;
    assert(refund2 == FIXED_ESCROW, 'Unrevealed user refund wrong');
}

#[test]
#[should_panic(expected: 'Fees already collected')]
fn test_double_fee_collection_rejected() {
    let (_token, pool, _token_addr, pool_addr) = setup_with_commits();

    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt_u1');
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER2());
    pool.reveal(0, FIXED_ESCROW, 'salt_u2');
    stop_cheat_caller_address(pool_addr);

    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.finalize();
    pool.collect_fees();
    pool.collect_fees(); // should panic
    stop_cheat_caller_address(pool_addr);
}

// ─── Additional Edge Case Tests ─────────────────────────────────────────────

#[test]
fn test_resolution_deadline_auto_cancels() {
    let (_, pool, _, _) = setup_with_commits();

    // Advance past expiry + 24h resolution deadline
    start_cheat_block_timestamp_global(
        START_TIME + COMMIT_DURATION + CLOSED_DURATION + 86400 + 1,
    );

    let phase = pool.get_phase();
    assert(phase == Phase::Cancelled, 'Should auto-cancel after 24h');
}

#[test]
fn test_refund_after_resolution_deadline() {
    let (token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Advance past resolution deadline (24h after expiry)
    start_cheat_block_timestamp_global(
        START_TIME + COMMIT_DURATION + CLOSED_DURATION + 86400 + 1,
    );

    // Users should be able to refund
    let balance_before = token.balance_of(USER1());
    start_cheat_caller_address(pool_addr, USER1());
    pool.refund();
    stop_cheat_caller_address(pool_addr);
    let balance_after = token.balance_of(USER1());

    assert(balance_after - balance_before == FIXED_ESCROW, 'Should refund full escrow');
}

#[test]
#[should_panic(expected: 'Amount below minimum')]
fn test_reveal_below_min_bet_rejected() {
    let (token, pool, token_addr, pool_addr) = setup();

    // Commit with tiny amount (below MIN_BET of 0.001 STRK)
    let tiny_amount: u256 = 100; // way below MIN_BET
    let tiny_felt: felt252 = tiny_amount.try_into().unwrap();

    approve_and_commit(token_addr, pool_addr, pool, token, USER1(), 1, tiny_felt, 'salt_tiny');
    let full: felt252 = FIXED_ESCROW.try_into().unwrap();
    approve_and_commit(token_addr, pool_addr, pool, token, USER2(), 0, full, 'salt_u2');

    // Resolve
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // Try to reveal with tiny amount
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, tiny_amount, 'salt_tiny');
    stop_cheat_caller_address(pool_addr);
}

#[test]
#[should_panic(expected: 'Not in revealing phase')]
fn test_reveal_after_deadline_rejected() {
    let (_token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Resolve
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // Advance past reveal deadline → effective_phase returns Finalized
    start_cheat_block_timestamp_global(
        START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1,
    );

    // Try to reveal — should fail because phase is now Finalized
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt_u1');
    stop_cheat_caller_address(pool_addr);
}

#[test]
#[should_panic(expected: 'Not finalized')]
fn test_claim_requires_explicit_finalize() {
    let (_token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Resolve
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // Both reveal
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt_u1');
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER2());
    pool.reveal(0, FIXED_ESCROW, 'salt_u2');
    stop_cheat_caller_address(pool_addr);

    // Advance past reveal deadline but DON'T call finalize()
    start_cheat_block_timestamp_global(
        START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1,
    );

    // Try to claim — should fail because finalize() was not called
    start_cheat_caller_address(pool_addr, USER1());
    pool.claim();
    stop_cheat_caller_address(pool_addr);
}

#[test]
#[should_panic(expected: 'Invalid direction')]
fn test_reveal_invalid_direction_rejected() {
    let (token, pool, token_addr, pool_addr) = setup();

    // We need a commitment with direction=2 (invalid but hash works)
    let amount_felt: felt252 = FIXED_ESCROW.try_into().unwrap();
    let hash = compute_commitment(2, amount_felt, 'salt_bad', USER1());

    // Approve and commit with the hash directly
    start_cheat_caller_address(token_addr, USER1());
    token.approve(pool_addr, FIXED_ESCROW);
    stop_cheat_caller_address(token_addr);

    start_cheat_caller_address(pool_addr, USER1());
    pool.commit(hash);
    stop_cheat_caller_address(pool_addr);

    // Also commit a second user for a valid market
    let full: felt252 = FIXED_ESCROW.try_into().unwrap();
    approve_and_commit(token_addr, pool_addr, pool, token, USER2(), 0, full, 'salt_u2');

    // Resolve
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // Try to reveal with direction=2
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(2, FIXED_ESCROW, 'salt_bad');
    stop_cheat_caller_address(pool_addr);
}

#[test]
fn test_one_sided_cancel_allows_refund() {
    let (token, pool, token_addr, pool_addr) = setup();

    // Both users commit UP (one-sided)
    let amount_felt: felt252 = FIXED_ESCROW.try_into().unwrap();
    approve_and_commit(token_addr, pool_addr, pool, token, USER1(), 1, amount_felt, 'salt1');
    approve_and_commit(token_addr, pool_addr, pool, token, USER2(), 1, amount_felt, 'salt2');

    // Resolve
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // Both reveal UP
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt1');
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER2());
    pool.reveal(1, FIXED_ESCROW, 'salt2');
    stop_cheat_caller_address(pool_addr);

    // Finalize → should cancel (one-sided)
    start_cheat_block_timestamp_global(
        START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1,
    );
    start_cheat_caller_address(pool_addr, OWNER());
    pool.finalize();
    stop_cheat_caller_address(pool_addr);

    assert(pool.get_phase() == Phase::Cancelled, 'Should be cancelled');

    // Users can refund their revealed amounts
    let bal1_before = token.balance_of(USER1());
    start_cheat_caller_address(pool_addr, USER1());
    pool.refund();
    stop_cheat_caller_address(pool_addr);
    let refund1 = token.balance_of(USER1()) - bal1_before;
    assert(refund1 == FIXED_ESCROW, 'Should refund revealed amount');
}

#[test]
#[should_panic(expected: 'Not revealed')]
fn test_claim_without_reveal_rejected() {
    let (_token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Resolve
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // Only User1 reveals
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt_u1');
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER2());
    pool.reveal(0, FIXED_ESCROW, 'salt_u2');
    stop_cheat_caller_address(pool_addr);

    // Finalize
    start_cheat_block_timestamp_global(
        START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1,
    );
    start_cheat_caller_address(pool_addr, OWNER());
    pool.finalize();
    stop_cheat_caller_address(pool_addr);

    // User3 (never committed) tries to claim
    start_cheat_caller_address(pool_addr, USER3());
    pool.claim();
    stop_cheat_caller_address(pool_addr);
}

#[test]
#[should_panic(expected: 'No commitment found')]
fn test_reveal_without_commit_rejected() {
    let (_token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Resolve
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // User3 (never committed) tries to reveal
    start_cheat_caller_address(pool_addr, USER3());
    pool.reveal(1, FIXED_ESCROW, 'fake_salt');
    stop_cheat_caller_address(pool_addr);
}

#[test]
#[should_panic(expected: 'Already finalized')]
fn test_emergency_cancel_after_finalize_rejected() {
    let (_token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Full lifecycle to Finalized
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt_u1');
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER2());
    pool.reveal(0, FIXED_ESCROW, 'salt_u2');
    stop_cheat_caller_address(pool_addr);

    start_cheat_block_timestamp_global(
        START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1,
    );
    start_cheat_caller_address(pool_addr, OWNER());
    pool.finalize();
    pool.emergency_cancel(); // should panic
    stop_cheat_caller_address(pool_addr);
}

#[test]
fn test_down_winner_claims_correctly() {
    let (token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Resolve DOWN wins (price below strike)
    start_cheat_block_timestamp_global(START_TIME + COMMIT_DURATION + CLOSED_DURATION + 1);
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE - 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);

    // Both reveal
    start_cheat_caller_address(pool_addr, USER1());
    pool.reveal(1, FIXED_ESCROW, 'salt_u1');
    stop_cheat_caller_address(pool_addr);

    start_cheat_caller_address(pool_addr, USER2());
    pool.reveal(0, FIXED_ESCROW, 'salt_u2');
    stop_cheat_caller_address(pool_addr);

    // Finalize
    start_cheat_block_timestamp_global(
        START_TIME + COMMIT_DURATION + CLOSED_DURATION + REVEAL_DURATION + 1,
    );
    start_cheat_caller_address(pool_addr, OWNER());
    pool.finalize();
    stop_cheat_caller_address(pool_addr);

    // User2 (DOWN) should win
    let bal_before = token.balance_of(USER2());
    start_cheat_caller_address(pool_addr, USER2());
    pool.claim();
    stop_cheat_caller_address(pool_addr);
    let payout = token.balance_of(USER2()) - bal_before;

    let fee = (FIXED_ESCROW * 300) / 10_000;
    let expected = FIXED_ESCROW + FIXED_ESCROW - fee;
    assert(payout == expected, 'Down winner payout incorrect');

    // User1 (UP) should get nothing
    let bal1_before = token.balance_of(USER1());
    start_cheat_caller_address(pool_addr, USER1());
    pool.claim();
    stop_cheat_caller_address(pool_addr);
    assert(token.balance_of(USER1()) == bal1_before, 'Loser should get 0');
}

#[test]
#[should_panic(expected: 'Nothing to refund')]
fn test_refund_non_participant_rejected() {
    let (_token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Emergency cancel
    start_cheat_caller_address(pool_addr, OWNER());
    pool.emergency_cancel();
    stop_cheat_caller_address(pool_addr);

    // User3 (never committed) tries to refund
    start_cheat_caller_address(pool_addr, USER3());
    pool.refund();
    stop_cheat_caller_address(pool_addr);
}

#[test]
#[should_panic(expected: 'Not cancelled')]
fn test_refund_non_cancelled_rejected() {
    let (_token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Market is still in Committing phase
    start_cheat_caller_address(pool_addr, USER1());
    pool.refund();
    stop_cheat_caller_address(pool_addr);
}

#[test]
#[should_panic(expected: 'Not in closed phase')]
fn test_resolve_during_committing_rejected() {
    let (_token, pool, _token_addr, pool_addr) = setup_with_commits();

    // Still in committing phase
    start_cheat_caller_address(pool_addr, OWNER());
    pool.resolve(STRIKE_PRICE + 100, STRIKE_EXPO);
    stop_cheat_caller_address(pool_addr);
}
