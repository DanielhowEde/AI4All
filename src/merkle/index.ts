// Core Merkle tree
export {
  sha256,
  hashPair,
  buildMerkleTree,
  computeMerkleRoot,
  verifyMerkleProof,
  ProofNode,
  MerkleProof,
  MerkleTreeResult,
} from './merkleTree';

// Reward-specific commitment
export {
  RewardEntry,
  RewardCommitment,
  RewardProof,
  toMicrounits,
  fromMicrounits,
  createLeaf,
  parseLeaf,
  sortRewardEntries,
  buildRewardCommitment,
  computeRewardRoot,
  verifyRewardProof,
  rewardsToEntries,
  serializeRewardProof,
  deserializeRewardProof,
} from './rewardCommitment';
