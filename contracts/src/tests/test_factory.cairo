use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait,
    start_cheat_caller_address, stop_cheat_caller_address,
    start_cheat_block_timestamp_global,
};
use starknet::ContractAddress;
#[feature("deprecated-starknet-consts")]
use starknet::contract_address_const;
use crate::interfaces::{IDarkPoolFactoryDispatcher, IDarkPoolFactoryDispatcherTrait};
use crate::interfaces::{IDarkPoolDispatcher, IDarkPoolDispatcherTrait};
use crate::types::Phase;

// ─── Constants ──────────────────────────────────────────────────────────────

const FIXED_ESCROW: u256 = 10_000_000_000_000_000_000; // 10 STRK
const COMMIT_DURATION: u64 = 150;
const CLOSED_DURATION: u64 = 150;
const REVEAL_DURATION: u64 = 300;
const STRIKE_PRICE: i64 = 9741230;
const STRIKE_EXPO: i32 = -2;
const START_TIME: u64 = 1000;

fn OWNER() -> ContractAddress {
    contract_address_const::<'owner'>()
}
fn USER1() -> ContractAddress {
    contract_address_const::<'user1'>()
}
fn FEE_COLLECTOR() -> ContractAddress {
    contract_address_const::<'fee_collector'>()
}
fn TOKEN() -> ContractAddress {
    contract_address_const::<'token'>()
}

// ─── Deploy helper ─────────────────────────────────────────────────────────

fn deploy_factory() -> (ContractAddress, IDarkPoolFactoryDispatcher) {
    let factory_class = declare("DarkPoolFactory").unwrap().contract_class();
    let darkpool_class = declare("DarkPool").unwrap().contract_class();
    let darkpool_class_hash = *darkpool_class.class_hash;

    let mut calldata: Array<felt252> = array![];
    OWNER().serialize(ref calldata);
    darkpool_class_hash.serialize(ref calldata);

    let (address, _) = factory_class.deploy(@calldata).unwrap();
    (address, IDarkPoolFactoryDispatcher { contract_address: address })
}

// ─── Tests ─────────────────────────────────────────────────────────────────

#[test]
fn test_factory_initial_state() {
    let (_, factory) = deploy_factory();
    assert(factory.get_market_count() == 0, 'count should be 0');
}

#[test]
fn test_factory_create_market() {
    let (factory_addr, factory) = deploy_factory();

    start_cheat_block_timestamp_global(START_TIME);
    start_cheat_caller_address(factory_addr, OWNER());

    let market_addr = factory.create_market(
        TOKEN(),
        FIXED_ESCROW,
        STRIKE_PRICE,
        STRIKE_EXPO,
        COMMIT_DURATION,
        CLOSED_DURATION,
        REVEAL_DURATION,
        FEE_COLLECTOR(),
    );

    stop_cheat_caller_address(factory_addr);

    // Market count incremented
    assert(factory.get_market_count() == 1, 'count should be 1');

    // Market address stored
    let stored_addr = factory.get_market(1);
    assert(stored_addr == market_addr, 'address mismatch');

    // Deployed market is functional — check phase
    let pool = IDarkPoolDispatcher { contract_address: market_addr };
    let info = pool.get_market_info();
    assert(info.phase == Phase::Committing, 'should be Committing');
    assert(info.market_id == 1, 'market_id should be 1');
    assert(info.strike_price == STRIKE_PRICE, 'strike mismatch');
    assert(info.fixed_escrow == FIXED_ESCROW, 'escrow mismatch');
}

#[test]
fn test_factory_create_multiple_markets() {
    let (factory_addr, factory) = deploy_factory();

    start_cheat_block_timestamp_global(START_TIME);
    start_cheat_caller_address(factory_addr, OWNER());

    let addr1 = factory.create_market(
        TOKEN(), FIXED_ESCROW, STRIKE_PRICE, STRIKE_EXPO,
        COMMIT_DURATION, CLOSED_DURATION, REVEAL_DURATION, FEE_COLLECTOR(),
    );
    let addr2 = factory.create_market(
        TOKEN(), FIXED_ESCROW, STRIKE_PRICE, STRIKE_EXPO,
        COMMIT_DURATION, CLOSED_DURATION, REVEAL_DURATION, FEE_COLLECTOR(),
    );

    stop_cheat_caller_address(factory_addr);

    assert(factory.get_market_count() == 2, 'count should be 2');
    assert(addr1 != addr2, 'addresses should differ');

    // Verify each market has correct ID
    let pool1 = IDarkPoolDispatcher { contract_address: addr1 };
    let pool2 = IDarkPoolDispatcher { contract_address: addr2 };
    assert(pool1.get_market_info().market_id == 1, 'market 1 id');
    assert(pool2.get_market_info().market_id == 2, 'market 2 id');
}

#[test]
#[should_panic(expected: 'Only owner')]
fn test_factory_create_non_owner_reverts() {
    let (factory_addr, factory) = deploy_factory();

    start_cheat_block_timestamp_global(START_TIME);
    start_cheat_caller_address(factory_addr, USER1());

    factory.create_market(
        TOKEN(), FIXED_ESCROW, STRIKE_PRICE, STRIKE_EXPO,
        COMMIT_DURATION, CLOSED_DURATION, REVEAL_DURATION, FEE_COLLECTOR(),
    );
}

#[test]
fn test_factory_get_market_zero_returns_zero() {
    let (_, factory) = deploy_factory();
    let addr = factory.get_market(999);
    let zero: ContractAddress = 0.try_into().unwrap();
    assert(addr == zero, 'nonexistent should be zero');
}
