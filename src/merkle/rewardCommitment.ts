import { buildMerkleTree, computeMerkleRoot, verifyMerkleProof } from './merkleTree';

/**
 * Reward entry for commitment
 */
export interface RewardEntry {
  accountId: string;
  amountMicrounits: bigint;
}

/**
 * Reward commitment result
 */
export interface RewardCommitment {
  dayId: string;
  root: string;
  leafCount: number;
  totalMicrounits: bigint;
  getProof(accountId: string): RewardProof | undefined;
}

/**
 * Reward-specific Merkle proof
 */
export interface RewardProof {
  dayId: string;
  accountId: string;
  amountMicrounits: bigint;
  leaf: string;
  leafHash: string;
  proof: Array<{ hash: string; position: 'left' | 'right' }>;
  root: string;
}

/**
 * Convert tokens to microunits (6 decimal places)
 * Matches the fixed-point arithmetic in rewardDistributionFixed.ts
 */
export function toMicrounits(tokens: number): bigint {
  return BigInt(Math.round(tokens * 1_000_000));
}

/**
 * Convert microunits back to tokens
 */
export function fromMicrounits(microunits: bigint): number {
  return Number(microunits) / 1_000_000;
}

/**
 * Leaf format version - increment if format changes
 */
const LEAF_VERSION = 'v1';

/**
 * Separator for leaf fields - null byte cannot appear in valid strings
 */
const LEAF_SEPARATOR = '\0';

/**
 * Validate that a string doesn't contain the leaf separator
 */
function validateNoSeparator(value: string, fieldName: string): void {
  if (value.includes(LEAF_SEPARATOR)) {
    throw new Error(`${fieldName} cannot contain null bytes`);
  }
}

/**
 * Create deterministic leaf string from reward entry
 *
 * Format: "v1\0accountId\0amountMicrounits\0dayId"
 *
 * Using null byte separator which cannot appear in valid UTF-8 strings.
 * Version prefix allows future format changes without breaking existing proofs.
 * Amount is in microunits (integer) for exact representation.
 */
export function createLeaf(accountId: string, amountMicrounits: bigint, dayId: string): string {
  // Validate inputs don't contain separator
  validateNoSeparator(accountId, 'accountId');
  validateNoSeparator(dayId, 'dayId');

  return [LEAF_VERSION, accountId, amountMicrounits.toString(), dayId].join(LEAF_SEPARATOR);
}

/**
 * Parse a leaf string back into components
 */
export function parseLeaf(leaf: string): { accountId: string; amountMicrounits: bigint; dayId: string } {
  const parts = leaf.split(LEAF_SEPARATOR);

  // Check for versioned format (v1)
  if (parts.length === 4 && parts[0] === LEAF_VERSION) {
    return {
      accountId: parts[1],
      amountMicrounits: BigInt(parts[2]),
      dayId: parts[3],
    };
  }

  throw new Error(`Invalid or unsupported leaf format`);
}

/**
 * Validate that all accountIds are unique
 * Throws if duplicates are found
 */
function validateUniqueAccountIds(entries: RewardEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.accountId)) {
      throw new Error(`Duplicate accountId in reward entries: ${entry.accountId}`);
    }
    seen.add(entry.accountId);
  }
}

/**
 * Sort reward entries lexicographically by accountId
 * This ensures deterministic ordering across all implementations
 * Throws if duplicate accountIds are found
 */
export function sortRewardEntries(entries: RewardEntry[]): RewardEntry[] {
  // Validate uniqueness before sorting
  validateUniqueAccountIds(entries);

  return [...entries].sort((a, b) => {
    // Sort by accountId lexicographically
    if (a.accountId < b.accountId) return -1;
    if (a.accountId > b.accountId) return 1;
    return 0;
  });
}

/**
 * Build a reward commitment (Merkle root) for a day's rewards
 *
 * @param dayId The day identifier (YYYY-MM-DD format)
 * @param rewards Array of reward entries (will be sorted internally)
 * @returns RewardCommitment with root and proof generation
 */
export function buildRewardCommitment(dayId: string, rewards: RewardEntry[]): RewardCommitment {
  // Sort rewards deterministically
  const sortedRewards = sortRewardEntries(rewards);

  // Create leaves in sorted order
  const leaves = sortedRewards.map(r => createLeaf(r.accountId, r.amountMicrounits, dayId));

  // Build Merkle tree
  const tree = buildMerkleTree(leaves);

  // Calculate total
  const totalMicrounits = sortedRewards.reduce(
    (sum, r) => sum + r.amountMicrounits,
    0n
  );

  // Create accountId -> index map for efficient proof lookup
  const accountIndex = new Map<string, number>();
  sortedRewards.forEach((r, i) => accountIndex.set(r.accountId, i));

  function getProof(accountId: string): RewardProof | undefined {
    const index = accountIndex.get(accountId);
    if (index === undefined) {
      return undefined;
    }

    const baseProof = tree.getProof(index);
    const reward = sortedRewards[index];

    return {
      dayId,
      accountId,
      amountMicrounits: reward.amountMicrounits,
      leaf: baseProof.leaf,
      leafHash: baseProof.leafHash,
      proof: baseProof.proof,
      root: baseProof.root,
    };
  }

  return {
    dayId,
    root: tree.root,
    leafCount: tree.leafCount,
    totalMicrounits,
    getProof,
  };
}

/**
 * Compute only the Merkle root for rewards (without full tree)
 * More efficient when proofs aren't needed
 */
export function computeRewardRoot(dayId: string, rewards: RewardEntry[]): string {
  const sortedRewards = sortRewardEntries(rewards);
  const leaves = sortedRewards.map(r => createLeaf(r.accountId, r.amountMicrounits, dayId));
  return computeMerkleRoot(leaves);
}

/**
 * Verify a reward proof
 *
 * @param proof The reward proof to verify
 * @returns true if proof is valid
 */
export function verifyRewardProof(proof: RewardProof): boolean {
  // Verify the leaf format matches the claimed values
  const expectedLeaf = createLeaf(proof.accountId, proof.amountMicrounits, proof.dayId);
  if (proof.leaf !== expectedLeaf) {
    return false;
  }

  // Verify the Merkle proof
  return verifyMerkleProof({
    leaf: proof.leaf,
    leafHash: proof.leafHash,
    proof: proof.proof,
    root: proof.root,
  });
}

/**
 * Convert ContributorReward array to RewardEntry array
 * Used to bridge from the existing reward distribution to Merkle commitment
 */
export function rewardsToEntries(
  rewards: Array<{ accountId: string; totalReward: number }>
): RewardEntry[] {
  return rewards.map(r => ({
    accountId: r.accountId,
    amountMicrounits: toMicrounits(r.totalReward),
  }));
}

/**
 * Convert microunits to string decimal representation
 * Returns exact decimal string without floating point errors
 * e.g., 1234567n -> "1.234567"
 */
function microunitsToDecimalString(microunits: bigint): string {
  const isNegative = microunits < 0n;
  const abs = isNegative ? -microunits : microunits;
  const str = abs.toString().padStart(7, '0'); // Ensure at least 7 chars (1 + 6 decimals)
  const intPart = str.slice(0, -6) || '0';
  const decPart = str.slice(-6);
  // Trim trailing zeros but keep at least one decimal place
  const trimmedDec = decPart.replace(/0+$/, '') || '0';
  return `${isNegative ? '-' : ''}${intPart}.${trimmedDec}`;
}

/**
 * Serialize a reward proof to JSON-safe format
 * (bigints are converted to strings)
 */
export function serializeRewardProof(proof: RewardProof): Record<string, unknown> {
  return {
    dayId: proof.dayId,
    accountId: proof.accountId,
    amountMicrounits: proof.amountMicrounits.toString(),
    amountTokens: microunitsToDecimalString(proof.amountMicrounits),
    leaf: proof.leaf,
    leafHash: proof.leafHash,
    proof: proof.proof,
    root: proof.root,
  };
}

/**
 * Deserialize a reward proof from JSON format
 */
export function deserializeRewardProof(data: Record<string, unknown>): RewardProof {
  return {
    dayId: data.dayId as string,
    accountId: data.accountId as string,
    amountMicrounits: BigInt(data.amountMicrounits as string),
    leaf: data.leaf as string,
    leafHash: data.leafHash as string,
    proof: data.proof as Array<{ hash: string; position: 'left' | 'right' }>,
    root: data.root as string,
  };
}
