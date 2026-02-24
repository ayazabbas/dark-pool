use starknet::ContractAddress;

// ─── Enums ──────────────────────────────────────────────────────────────────

#[derive(Drop, Copy, Serde, PartialEq, starknet::Store)]
pub enum Phase {
    #[default]
    Committing,
    Closed,
    Resolved,
    Revealing,
    Finalized,
    Cancelled,
}

#[derive(Drop, Copy, Serde, PartialEq, starknet::Store)]
pub enum Side {
    #[default]
    Up,
    Down,
    None,
}

// ─── Structs ────────────────────────────────────────────────────────────────

#[derive(Drop, Copy, Serde)]
pub struct MarketInfo {
    pub market_id: u64,
    pub phase: Phase,
    pub strike_price: i64,
    pub strike_price_expo: i32,
    pub resolution_price: i64,
    pub outcome: Side,
    pub start_time: u64,
    pub commit_deadline: u64,
    pub expiry_time: u64,
    pub reveal_deadline: u64,
    pub fixed_escrow: u256,
    pub commit_count: u32,
    pub reveal_count: u32,
    pub up_pool: u256,
    pub down_pool: u256,
    pub total_forfeited: u256,
}

// ─── Events ─────────────────────────────────────────────────────────────────

#[derive(Drop, starknet::Event)]
pub struct Committed {
    #[key]
    pub user: ContractAddress,
    pub commitment_hash: felt252,
}

#[derive(Drop, starknet::Event)]
pub struct MarketResolved {
    pub outcome: Side,
    pub resolution_price: i64,
    #[key]
    pub resolver: ContractAddress,
}

#[derive(Drop, starknet::Event)]
pub struct Revealed {
    #[key]
    pub user: ContractAddress,
    pub direction: felt252,
    pub amount: u256,
}

#[derive(Drop, starknet::Event)]
pub struct Claimed {
    #[key]
    pub user: ContractAddress,
    pub payout: u256,
}

#[derive(Drop, starknet::Event)]
pub struct Refunded {
    #[key]
    pub user: ContractAddress,
    pub amount: u256,
}

#[derive(Drop, starknet::Event)]
pub struct MarketCancelled {
    pub reason: ByteArray,
}

#[derive(Drop, starknet::Event)]
pub struct MarketFinalized {
    pub total_forfeited: u256,
}

#[derive(Drop, starknet::Event)]
pub struct FeesCollected {
    pub amount: u256,
    #[key]
    pub collector: ContractAddress,
}
