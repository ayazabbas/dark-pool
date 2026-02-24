use core::poseidon::PoseidonTrait;
use core::hash::HashStateTrait;
use starknet::ContractAddress;

/// Compute Poseidon commitment hash.
/// Must match starknet.js hash.computePoseidonHashOnElements([direction, amount, salt, user])
pub fn compute_commitment(
    direction: felt252, amount: felt252, salt: felt252, user: ContractAddress,
) -> felt252 {
    PoseidonTrait::new()
        .update(direction)
        .update(amount)
        .update(salt)
        .update(user.into())
        .finalize()
}

/// Verify a commitment hash matches the provided inputs.
pub fn verify_commitment(
    stored_hash: felt252,
    direction: felt252,
    amount: felt252,
    salt: felt252,
    user: ContractAddress,
) -> bool {
    compute_commitment(direction, amount, salt, user) == stored_hash
}
