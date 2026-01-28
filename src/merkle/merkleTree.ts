import * as crypto from 'crypto';

/**
 * Hash function using SHA-256
 */
export function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Hash two child hashes together to create parent hash
 * Position matters: hashPair(a, b) != hashPair(b, a)
 * Uses "node:" prefix for domain separation from leaf hashes
 */
export function hashPair(left: string, right: string): string {
  return sha256('node:' + left + right);
}

/**
 * Merkle proof node indicating sibling hash and position
 */
export interface ProofNode {
  hash: string;
  position: 'left' | 'right';
}

/**
 * Complete Merkle proof for a leaf
 */
export interface MerkleProof {
  leaf: string;
  leafHash: string;
  proof: ProofNode[];
  root: string;
}

/**
 * Merkle tree result containing root and proof generation capability
 */
export interface MerkleTreeResult {
  root: string;
  leafCount: number;
  leaves: string[];
  leafHashes: string[];
  getProof(index: number): MerkleProof;
  getProofByLeaf(leaf: string): MerkleProof | undefined;
}

/**
 * Build a Merkle tree from an array of leaf data strings.
 *
 * Tree structure:
 * - Leaves are hashed with a "leaf:" prefix to prevent second preimage attacks
 * - Internal nodes are created by hashing sorted pairs of children
 * - If odd number of nodes at a level, last node is promoted unchanged
 *
 * @param leaves Array of leaf data (will be hashed)
 * @returns MerkleTreeResult with root and proof generation
 */
export function buildMerkleTree(leaves: string[]): MerkleTreeResult {
  if (leaves.length === 0) {
    // Empty tree has a special root
    const emptyRoot = sha256('EMPTY_MERKLE_TREE');
    return {
      root: emptyRoot,
      leafCount: 0,
      leaves: [],
      leafHashes: [],
      getProof: () => {
        throw new Error('Cannot generate proof for empty tree');
      },
      getProofByLeaf: () => undefined,
    };
  }

  // Hash leaves with prefix to prevent second preimage attacks
  const leafHashes = leaves.map(leaf => sha256('leaf:' + leaf));

  // Build tree levels from bottom up
  // levels[0] = leaf hashes, levels[n] = root
  const levels: string[][] = [leafHashes];

  let currentLevel = leafHashes;
  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        // Pair exists - hash together
        nextLevel.push(hashPair(currentLevel[i], currentLevel[i + 1]));
      } else {
        // Odd node - promote unchanged
        nextLevel.push(currentLevel[i]);
      }
    }

    levels.push(nextLevel);
    currentLevel = nextLevel;
  }

  const root = currentLevel[0];

  /**
   * Generate proof for leaf at given index
   */
  function getProof(index: number): MerkleProof {
    if (index < 0 || index >= leaves.length) {
      throw new Error(`Invalid leaf index: ${index}`);
    }

    const proof: ProofNode[] = [];
    let currentIndex = index;

    // Walk up the tree, collecting sibling hashes
    for (let level = 0; level < levels.length - 1; level++) {
      const levelNodes = levels[level];
      const isLeft = currentIndex % 2 === 0;
      const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;

      if (siblingIndex < levelNodes.length) {
        proof.push({
          hash: levelNodes[siblingIndex],
          position: isLeft ? 'right' : 'left',
        });
      }
      // If no sibling (odd node), no proof node needed for this level

      // Move to parent index
      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      leaf: leaves[index],
      leafHash: leafHashes[index],
      proof,
      root,
    };
  }

  /**
   * Generate proof for leaf by its data value
   */
  function getProofByLeaf(leaf: string): MerkleProof | undefined {
    const index = leaves.indexOf(leaf);
    if (index === -1) {
      return undefined;
    }
    return getProof(index);
  }

  return {
    root,
    leafCount: leaves.length,
    leaves,
    leafHashes,
    getProof,
    getProofByLeaf,
  };
}

/**
 * Verify a Merkle proof
 *
 * @param proof The proof to verify
 * @returns true if proof is valid
 */
export function verifyMerkleProof(proof: MerkleProof): boolean {
  // Compute leaf hash
  const computedLeafHash = sha256('leaf:' + proof.leaf);

  if (computedLeafHash !== proof.leafHash) {
    return false;
  }

  // Walk up the tree using proof nodes
  let currentHash = proof.leafHash;

  for (const node of proof.proof) {
    if (node.position === 'left') {
      currentHash = hashPair(node.hash, currentHash);
    } else {
      currentHash = hashPair(currentHash, node.hash);
    }
  }

  return currentHash === proof.root;
}

/**
 * Compute just the Merkle root without storing the full tree
 * More memory efficient for large datasets when proofs aren't needed
 *
 * @param leaves Array of leaf data
 * @returns Merkle root hash
 */
export function computeMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) {
    return sha256('EMPTY_MERKLE_TREE');
  }

  // Hash leaves
  let currentLevel = leaves.map(leaf => sha256('leaf:' + leaf));

  // Reduce to root
  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        nextLevel.push(hashPair(currentLevel[i], currentLevel[i + 1]));
      } else {
        nextLevel.push(currentLevel[i]);
      }
    }

    currentLevel = nextLevel;
  }

  return currentLevel[0];
}
