import { hash, stark } from "starknet";

/**
 * Compute Poseidon commitment hash matching the Cairo contract.
 * commitment = poseidon(direction, amount, salt, user_address)
 */
export function computeCommitment(
  direction: 0 | 1,
  amount: bigint,
  salt: string,
  userAddress: string
): string {
  return hash.computePoseidonHashOnElements([
    BigInt(direction),
    amount,
    BigInt(salt),
    BigInt(userAddress),
  ]);
}

/**
 * Generate a random salt for commitment.
 */
export function generateSalt(): string {
  return stark.randomAddress();
}
