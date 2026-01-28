import {
  sha256,
  hashPair,
  buildMerkleTree,
  verifyMerkleProof,
  computeMerkleRoot,
} from '../merkleTree';

describe('sha256', () => {
  it('should produce consistent hash for same input', () => {
    const hash1 = sha256('hello');
    const hash2 = sha256('hello');
    expect(hash1).toBe(hash2);
  });

  it('should produce different hash for different input', () => {
    const hash1 = sha256('hello');
    const hash2 = sha256('world');
    expect(hash1).not.toBe(hash2);
  });

  it('should produce 64 character hex string', () => {
    const hash = sha256('test');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});

describe('hashPair', () => {
  it('should produce different hash for different order (position matters)', () => {
    const hash1 = hashPair('aaa', 'bbb');
    const hash2 = hashPair('bbb', 'aaa');
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hash for different inputs', () => {
    const hash1 = hashPair('aaa', 'bbb');
    const hash2 = hashPair('aaa', 'ccc');
    expect(hash1).not.toBe(hash2);
  });

  it('should be deterministic', () => {
    const hash1 = hashPair('left', 'right');
    const hash2 = hashPair('left', 'right');
    expect(hash1).toBe(hash2);
  });
});

describe('buildMerkleTree', () => {
  it('should handle empty tree', () => {
    const tree = buildMerkleTree([]);
    expect(tree.root).toBeDefined();
    expect(tree.leafCount).toBe(0);
    expect(tree.leaves).toHaveLength(0);
    expect(() => tree.getProof(0)).toThrow('Cannot generate proof for empty tree');
  });

  it('should handle single leaf', () => {
    const tree = buildMerkleTree(['only-one']);
    expect(tree.root).toBeDefined();
    expect(tree.leafCount).toBe(1);

    const proof = tree.getProof(0);
    expect(proof.leaf).toBe('only-one');
    expect(proof.proof).toHaveLength(0); // No siblings needed
    expect(verifyMerkleProof(proof)).toBe(true);
  });

  it('should handle two leaves', () => {
    const tree = buildMerkleTree(['leaf1', 'leaf2']);
    expect(tree.leafCount).toBe(2);

    const proof0 = tree.getProof(0);
    const proof1 = tree.getProof(1);

    expect(proof0.proof).toHaveLength(1);
    expect(proof1.proof).toHaveLength(1);

    expect(verifyMerkleProof(proof0)).toBe(true);
    expect(verifyMerkleProof(proof1)).toBe(true);
  });

  it('should handle three leaves (odd number)', () => {
    const tree = buildMerkleTree(['a', 'b', 'c']);
    expect(tree.leafCount).toBe(3);

    for (let i = 0; i < 3; i++) {
      const proof = tree.getProof(i);
      expect(verifyMerkleProof(proof)).toBe(true);
    }
  });

  it('should handle four leaves (power of 2)', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    expect(tree.leafCount).toBe(4);

    for (let i = 0; i < 4; i++) {
      const proof = tree.getProof(i);
      expect(verifyMerkleProof(proof)).toBe(true);
    }
  });

  it('should handle larger tree', () => {
    const leaves = Array.from({ length: 100 }, (_, i) => `leaf-${i}`);
    const tree = buildMerkleTree(leaves);

    expect(tree.leafCount).toBe(100);

    // Verify a few random proofs
    for (const i of [0, 49, 99]) {
      const proof = tree.getProof(i);
      expect(verifyMerkleProof(proof)).toBe(true);
      expect(proof.leaf).toBe(`leaf-${i}`);
    }
  });

  it('should produce deterministic root', () => {
    const leaves = ['a', 'b', 'c'];
    const tree1 = buildMerkleTree(leaves);
    const tree2 = buildMerkleTree(leaves);
    expect(tree1.root).toBe(tree2.root);
  });

  it('should produce different root for different leaves', () => {
    const tree1 = buildMerkleTree(['a', 'b', 'c']);
    const tree2 = buildMerkleTree(['a', 'b', 'd']);
    expect(tree1.root).not.toBe(tree2.root);
  });

  it('should produce different root for different order', () => {
    const tree1 = buildMerkleTree(['a', 'b', 'c']);
    const tree2 = buildMerkleTree(['b', 'a', 'c']);
    expect(tree1.root).not.toBe(tree2.root);
  });

  it('should find proof by leaf value', () => {
    const tree = buildMerkleTree(['alice', 'bob', 'charlie']);

    const bobProof = tree.getProofByLeaf('bob');
    expect(bobProof).toBeDefined();
    expect(bobProof!.leaf).toBe('bob');
    expect(verifyMerkleProof(bobProof!)).toBe(true);

    const unknownProof = tree.getProofByLeaf('unknown');
    expect(unknownProof).toBeUndefined();
  });

  it('should throw for invalid index', () => {
    const tree = buildMerkleTree(['a', 'b']);
    expect(() => tree.getProof(-1)).toThrow('Invalid leaf index');
    expect(() => tree.getProof(2)).toThrow('Invalid leaf index');
  });
});

describe('verifyMerkleProof', () => {
  it('should reject proof with tampered leaf', () => {
    const tree = buildMerkleTree(['a', 'b', 'c']);
    const proof = tree.getProof(1);

    // Tamper with the leaf
    const tamperedProof = { ...proof, leaf: 'tampered' };
    expect(verifyMerkleProof(tamperedProof)).toBe(false);
  });

  it('should reject proof with tampered root', () => {
    const tree = buildMerkleTree(['a', 'b', 'c']);
    const proof = tree.getProof(1);

    const tamperedProof = { ...proof, root: 'wrong-root' };
    expect(verifyMerkleProof(tamperedProof)).toBe(false);
  });

  it('should reject proof with tampered proof node', () => {
    const tree = buildMerkleTree(['a', 'b', 'c', 'd']);
    const proof = tree.getProof(1);

    // Tamper with a proof node
    const tamperedProof = {
      ...proof,
      proof: [{ ...proof.proof[0], hash: 'tampered-hash' }, ...proof.proof.slice(1)],
    };
    expect(verifyMerkleProof(tamperedProof)).toBe(false);
  });

  it('should reject proof with wrong leafHash', () => {
    const tree = buildMerkleTree(['a', 'b', 'c']);
    const proof = tree.getProof(1);

    const tamperedProof = { ...proof, leafHash: 'wrong-hash' };
    expect(verifyMerkleProof(tamperedProof)).toBe(false);
  });
});

describe('computeMerkleRoot', () => {
  it('should produce same root as buildMerkleTree', () => {
    const leaves = ['a', 'b', 'c', 'd', 'e'];
    const tree = buildMerkleTree(leaves);
    const root = computeMerkleRoot(leaves);
    expect(root).toBe(tree.root);
  });

  it('should handle empty input', () => {
    const root = computeMerkleRoot([]);
    const tree = buildMerkleTree([]);
    expect(root).toBe(tree.root);
  });

  it('should be deterministic', () => {
    const leaves = ['x', 'y', 'z'];
    const root1 = computeMerkleRoot(leaves);
    const root2 = computeMerkleRoot(leaves);
    expect(root1).toBe(root2);
  });
});
