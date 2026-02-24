use starknet::ContractAddress;
use crate::types::{MarketInfo, Phase};

#[starknet::interface]
pub trait IDarkPool<TContractState> {
    // Phase: Committing
    fn commit(ref self: TContractState, commitment_hash: felt252);

    // Phase: Closed → Resolved (owner-only for MVP — keeper passes Pyth price off-chain)
    fn resolve(ref self: TContractState, price: i64, expo: i32);

    // Phase: Revealing
    fn reveal(ref self: TContractState, direction: felt252, amount: u256, salt: felt252);

    // Phase: Finalized
    fn claim(ref self: TContractState);
    fn refund(ref self: TContractState); // Only for Cancelled markets

    // Admin
    fn finalize(ref self: TContractState); // Force finalize after reveal deadline
    fn emergency_cancel(ref self: TContractState);
    fn collect_fees(ref self: TContractState);

    // View functions
    fn get_market_info(self: @TContractState) -> MarketInfo;
    fn get_phase(self: @TContractState) -> Phase;
    fn get_commitment(self: @TContractState, user: ContractAddress) -> felt252;
    fn has_user_committed(self: @TContractState, user: ContractAddress) -> bool;
    fn has_user_revealed(self: @TContractState, user: ContractAddress) -> bool;
    fn has_user_claimed(self: @TContractState, user: ContractAddress) -> bool;
    fn get_pool_sizes(self: @TContractState) -> (u256, u256, u256); // up, down, total_revealed
}
