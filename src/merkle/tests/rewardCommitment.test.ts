import {
  createLeaf,
  parseLeaf,
  sortRewardEntries,
  buildRewardCommitment,
  computeRewardRoot,
  verifyRewardProof,
  rewardsToEntries,
  toMicrounits,
  fromMicrounits,
  serializeRewardProof,
  deserializeRewardProof,
  RewardEntry,
} from '../rewardCommitment';

describe('toMicrounits / fromMicrounits (nanounits)', () => {
  it('should convert tokens to nanounits', () => {
    expect(toMicrounits(1)).toBe(1_000_000_000n);
    expect(toMicrounits(1.5)).toBe(1_500_000_000n);
    expect(toMicrounits(0.000000001)).toBe(1n);
    expect(toMicrounits(22000)).toBe(22_000_000_000_000n);
  });

  it('should convert nanounits to tokens', () => {
    expect(fromMicrounits(1_000_000_000n)).toBe(1);
    expect(fromMicrounits(1_500_000_000n)).toBe(1.5);
    expect(fromMicrounits(1n)).toBe(0.000000001);
  });

  it('should round-trip correctly', () => {
    const original = 123.456789;
    const microunits = toMicrounits(original);
    const roundTripped = fromMicrounits(microunits);
    expect(roundTripped).toBeCloseTo(original, 5);
  });
});

describe('createLeaf / parseLeaf', () => {
  it('should create deterministic versioned leaf string', () => {
    const leaf = createLeaf('alice', 1_000_000n, '2026-01-28');
    // v1\0accountId\0amount\0dayId
    const expected = ['v1', 'alice', '1000000', '2026-01-28'].join('\x00');
    expect(leaf).toBe(expected);
  });

  it('should round-trip leaf creation/parsing', () => {
    const original = { accountId: 'charlie', amountMicrounits: 3_141_592n, dayId: '2026-02-01' };
    const leaf = createLeaf(original.accountId, original.amountMicrounits, original.dayId);
    const parsed = parseLeaf(leaf);
    expect(parsed).toEqual(original);
  });

  it('should throw on invalid leaf format', () => {
    expect(() => parseLeaf('invalid')).toThrow('Invalid or unsupported leaf format');
    expect(() => parseLeaf('a|b')).toThrow('Invalid or unsupported leaf format');
  });

  it('should throw on legacy pipe-delimited format', () => {
    expect(() => parseLeaf('bob|2500000|2026-01-29')).toThrow('Invalid or unsupported leaf format');
  });

  it('should reject accountId with null bytes', () => {
    expect(() => createLeaf('alice\0bob', 1_000_000n, '2026-01-28')).toThrow('accountId cannot contain null bytes');
  });

  it('should reject dayId with null bytes', () => {
    expect(() => createLeaf('alice', 1_000_000n, '2026\0-01-28')).toThrow('dayId cannot contain null bytes');
  });
});

describe('sortRewardEntries', () => {
  it('should sort by accountId lexicographically', () => {
    const entries: RewardEntry[] = [
      { accountId: 'charlie', amountMicrounits: 100n },
      { accountId: 'alice', amountMicrounits: 200n },
      { accountId: 'bob', amountMicrounits: 150n },
    ];

    const sorted = sortRewardEntries(entries);

    expect(sorted[0].accountId).toBe('alice');
    expect(sorted[1].accountId).toBe('bob');
    expect(sorted[2].accountId).toBe('charlie');
  });

  it('should not modify original array', () => {
    const entries: RewardEntry[] = [
      { accountId: 'bob', amountMicrounits: 100n },
      { accountId: 'alice', amountMicrounits: 200n },
    ];

    sortRewardEntries(entries);

    expect(entries[0].accountId).toBe('bob'); // Original unchanged
  });

  it('should throw error for duplicate accountIds', () => {
    const entries: RewardEntry[] = [
      { accountId: 'alice', amountMicrounits: 200n },
      { accountId: 'alice', amountMicrounits: 100n },
    ];

    expect(() => sortRewardEntries(entries)).toThrow('Duplicate accountId in reward entries: alice');
  });

  it('should throw error for duplicate accountIds even with same amount', () => {
    const entries: RewardEntry[] = [
      { accountId: 'bob', amountMicrounits: 100n },
      { accountId: 'alice', amountMicrounits: 200n },
      { accountId: 'bob', amountMicrounits: 100n },
    ];

    expect(() => sortRewardEntries(entries)).toThrow('Duplicate accountId in reward entries: bob');
  });
});

describe('buildRewardCommitment', () => {
  const testRewards: RewardEntry[] = [
    { accountId: 'alice', amountMicrounits: 1_000_000n },
    { accountId: 'bob', amountMicrounits: 2_000_000n },
    { accountId: 'charlie', amountMicrounits: 3_000_000n },
  ];

  it('should build commitment with correct leaf count', () => {
    const commitment = buildRewardCommitment('2026-01-28', testRewards);
    expect(commitment.leafCount).toBe(3);
  });

  it('should calculate total microunits', () => {
    const commitment = buildRewardCommitment('2026-01-28', testRewards);
    expect(commitment.totalMicrounits).toBe(6_000_000n);
  });

  it('should include dayId', () => {
    const commitment = buildRewardCommitment('2026-01-28', testRewards);
    expect(commitment.dayId).toBe('2026-01-28');
  });

  it('should produce deterministic root', () => {
    const commitment1 = buildRewardCommitment('2026-01-28', testRewards);
    const commitment2 = buildRewardCommitment('2026-01-28', testRewards);
    expect(commitment1.root).toBe(commitment2.root);
  });

  it('should produce same root regardless of input order', () => {
    const shuffled = [testRewards[2], testRewards[0], testRewards[1]];
    const commitment1 = buildRewardCommitment('2026-01-28', testRewards);
    const commitment2 = buildRewardCommitment('2026-01-28', shuffled);
    expect(commitment1.root).toBe(commitment2.root);
  });

  it('should produce different root for different dayId', () => {
    const commitment1 = buildRewardCommitment('2026-01-28', testRewards);
    const commitment2 = buildRewardCommitment('2026-01-29', testRewards);
    expect(commitment1.root).not.toBe(commitment2.root);
  });

  it('should produce different root for different amounts', () => {
    const modified = [
      ...testRewards.slice(0, 2),
      { accountId: 'charlie', amountMicrounits: 4_000_000n }, // Changed amount
    ];
    const commitment1 = buildRewardCommitment('2026-01-28', testRewards);
    const commitment2 = buildRewardCommitment('2026-01-28', modified);
    expect(commitment1.root).not.toBe(commitment2.root);
  });

  it('should generate valid proof for each account', () => {
    const commitment = buildRewardCommitment('2026-01-28', testRewards);

    for (const reward of testRewards) {
      const proof = commitment.getProof(reward.accountId);
      expect(proof).toBeDefined();
      expect(proof!.accountId).toBe(reward.accountId);
      expect(proof!.amountMicrounits).toBe(reward.amountMicrounits);
      expect(proof!.dayId).toBe('2026-01-28');
      expect(proof!.root).toBe(commitment.root);
      expect(verifyRewardProof(proof!)).toBe(true);
    }
  });

  it('should return undefined for unknown account', () => {
    const commitment = buildRewardCommitment('2026-01-28', testRewards);
    const proof = commitment.getProof('unknown');
    expect(proof).toBeUndefined();
  });

  it('should handle empty rewards', () => {
    const commitment = buildRewardCommitment('2026-01-28', []);
    expect(commitment.leafCount).toBe(0);
    expect(commitment.totalMicrounits).toBe(0n);
    expect(commitment.root).toBeDefined();
  });

  it('should handle single reward', () => {
    const commitment = buildRewardCommitment('2026-01-28', [testRewards[0]]);
    expect(commitment.leafCount).toBe(1);

    const proof = commitment.getProof('alice');
    expect(proof).toBeDefined();
    expect(verifyRewardProof(proof!)).toBe(true);
  });
});

describe('computeRewardRoot', () => {
  it('should produce same root as buildRewardCommitment', () => {
    const rewards: RewardEntry[] = [
      { accountId: 'alice', amountMicrounits: 1_000_000n },
      { accountId: 'bob', amountMicrounits: 2_000_000n },
    ];

    const commitment = buildRewardCommitment('2026-01-28', rewards);
    const root = computeRewardRoot('2026-01-28', rewards);

    expect(root).toBe(commitment.root);
  });

  it('should be deterministic regardless of input order', () => {
    const rewards1: RewardEntry[] = [
      { accountId: 'bob', amountMicrounits: 200n },
      { accountId: 'alice', amountMicrounits: 100n },
    ];
    const rewards2: RewardEntry[] = [
      { accountId: 'alice', amountMicrounits: 100n },
      { accountId: 'bob', amountMicrounits: 200n },
    ];

    const root1 = computeRewardRoot('2026-01-28', rewards1);
    const root2 = computeRewardRoot('2026-01-28', rewards2);

    expect(root1).toBe(root2);
  });
});

describe('verifyRewardProof', () => {
  it('should verify valid proof', () => {
    const rewards: RewardEntry[] = [
      { accountId: 'alice', amountMicrounits: 1_000_000n },
      { accountId: 'bob', amountMicrounits: 2_000_000n },
    ];
    const commitment = buildRewardCommitment('2026-01-28', rewards);
    const proof = commitment.getProof('alice')!;

    expect(verifyRewardProof(proof)).toBe(true);
  });

  it('should reject proof with wrong accountId', () => {
    const commitment = buildRewardCommitment('2026-01-28', [
      { accountId: 'alice', amountMicrounits: 1_000_000n },
    ]);
    const proof = commitment.getProof('alice')!;

    const tampered = { ...proof, accountId: 'mallory' };
    expect(verifyRewardProof(tampered)).toBe(false);
  });

  it('should reject proof with wrong amount', () => {
    const commitment = buildRewardCommitment('2026-01-28', [
      { accountId: 'alice', amountMicrounits: 1_000_000n },
    ]);
    const proof = commitment.getProof('alice')!;

    const tampered = { ...proof, amountMicrounits: 9_999_999n };
    expect(verifyRewardProof(tampered)).toBe(false);
  });

  it('should reject proof with wrong dayId', () => {
    const commitment = buildRewardCommitment('2026-01-28', [
      { accountId: 'alice', amountMicrounits: 1_000_000n },
    ]);
    const proof = commitment.getProof('alice')!;

    const tampered = { ...proof, dayId: '2026-01-29' };
    expect(verifyRewardProof(tampered)).toBe(false);
  });
});

describe('rewardsToEntries', () => {
  it('should convert ContributorReward format to RewardEntry', () => {
    const rewards = [
      { accountId: 'alice', totalReward: 1.5 },
      { accountId: 'bob', totalReward: 2.25 },
    ];

    const entries = rewardsToEntries(rewards);

    expect(entries).toHaveLength(2);
    expect(entries[0].accountId).toBe('alice');
    expect(entries[0].amountMicrounits).toBe(1_500_000_000n);
    expect(entries[1].accountId).toBe('bob');
    expect(entries[1].amountMicrounits).toBe(2_250_000_000n);
  });
});

describe('serializeRewardProof / deserializeRewardProof', () => {
  it('should serialize proof to JSON-safe format with string decimal', () => {
    const commitment = buildRewardCommitment('2026-01-28', [
      { accountId: 'alice', amountMicrounits: 1_500_000_000n },
    ]);
    const proof = commitment.getProof('alice')!;

    const serialized = serializeRewardProof(proof);

    expect(serialized.amountMicrounits).toBe('1500000000');
    expect(serialized.amountTokens).toBe('1.5'); // String decimal, not float
    expect(typeof serialized.amountMicrounits).toBe('string');
    expect(typeof serialized.amountTokens).toBe('string');
  });

  it('should serialize small amounts correctly', () => {
    const commitment = buildRewardCommitment('2026-01-28', [
      { accountId: 'alice', amountMicrounits: 123n },
    ]);
    const proof = commitment.getProof('alice')!;

    const serialized = serializeRewardProof(proof);

    expect(serialized.amountMicrounits).toBe('123');
    expect(serialized.amountTokens).toBe('0.000000123');
  });

  it('should serialize zero amount correctly', () => {
    const commitment = buildRewardCommitment('2026-01-28', [
      { accountId: 'alice', amountMicrounits: 0n },
    ]);
    const proof = commitment.getProof('alice')!;

    const serialized = serializeRewardProof(proof);

    expect(serialized.amountMicrounits).toBe('0');
    expect(serialized.amountTokens).toBe('0.0');
  });

  it('should serialize exact integer amounts correctly', () => {
    const commitment = buildRewardCommitment('2026-01-28', [
      { accountId: 'alice', amountMicrounits: 5_000_000_000n },
    ]);
    const proof = commitment.getProof('alice')!;

    const serialized = serializeRewardProof(proof);

    expect(serialized.amountMicrounits).toBe('5000000000');
    expect(serialized.amountTokens).toBe('5.0');
  });

  it('should round-trip through serialization', () => {
    const commitment = buildRewardCommitment('2026-01-28', [
      { accountId: 'alice', amountMicrounits: 2_718_281_828n },
    ]);
    const original = commitment.getProof('alice')!;

    const serialized = serializeRewardProof(original);
    const deserialized = deserializeRewardProof(serialized);

    expect(deserialized.accountId).toBe(original.accountId);
    expect(deserialized.amountMicrounits).toBe(original.amountMicrounits);
    expect(deserialized.dayId).toBe(original.dayId);
    expect(deserialized.leaf).toBe(original.leaf);
    expect(deserialized.leafHash).toBe(original.leafHash);
    expect(deserialized.root).toBe(original.root);
    expect(deserialized.proof).toEqual(original.proof);

    // Deserialized proof should still verify
    expect(verifyRewardProof(deserialized)).toBe(true);
  });
});

describe('determinism across multiple runs', () => {
  it('should produce identical root for identical input', () => {
    // Simulate multiple independent computations
    const rewards: RewardEntry[] = [
      { accountId: 'node-1', amountMicrounits: 5_000_000n },
      { accountId: 'node-2', amountMicrounits: 3_000_000n },
      { accountId: 'node-3', amountMicrounits: 7_000_000n },
      { accountId: 'node-4', amountMicrounits: 2_000_000n },
      { accountId: 'node-5', amountMicrounits: 5_000_000n },
    ];

    const roots: string[] = [];
    for (let i = 0; i < 10; i++) {
      // Shuffle input each time
      const shuffled = [...rewards].sort(() => Math.random() - 0.5);
      const root = computeRewardRoot('2026-01-28', shuffled);
      roots.push(root);
    }

    // All roots should be identical
    const uniqueRoots = new Set(roots);
    expect(uniqueRoots.size).toBe(1);
  });
});

/**
 * Tamper Suite Tests
 * Comprehensive tests to ensure any tampering with proof data is detected
 */
describe('tamper suite', () => {
  const testRewards: RewardEntry[] = [
    { accountId: 'alice', amountMicrounits: 1_000_000n },
    { accountId: 'bob', amountMicrounits: 2_000_000n },
    { accountId: 'charlie', amountMicrounits: 3_000_000n },
    { accountId: 'dave', amountMicrounits: 4_000_000n },
  ];

  const dayId = '2026-01-28';

  function getValidProof() {
    const commitment = buildRewardCommitment(dayId, testRewards);
    return commitment.getProof('bob')!;
  }

  describe('accountId tampering', () => {
    it('should reject proof with changed accountId', () => {
      const proof = getValidProof();
      const tampered = { ...proof, accountId: 'mallory' };
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject proof with similar accountId', () => {
      const proof = getValidProof();
      const tampered = { ...proof, accountId: 'Bob' }; // Different case
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject proof with empty accountId', () => {
      const proof = getValidProof();
      const tampered = { ...proof, accountId: '' };
      expect(verifyRewardProof(tampered)).toBe(false);
    });
  });

  describe('amount tampering', () => {
    it('should reject proof with increased amount', () => {
      const proof = getValidProof();
      const tampered = { ...proof, amountMicrounits: 999_999_999n };
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject proof with decreased amount', () => {
      const proof = getValidProof();
      const tampered = { ...proof, amountMicrounits: 1n };
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject proof with zero amount', () => {
      const proof = getValidProof();
      const tampered = { ...proof, amountMicrounits: 0n };
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject proof with off-by-one amount', () => {
      const proof = getValidProof();
      const tampered = { ...proof, amountMicrounits: proof.amountMicrounits + 1n };
      expect(verifyRewardProof(tampered)).toBe(false);
    });
  });

  describe('dayId tampering', () => {
    it('should reject proof with different dayId', () => {
      const proof = getValidProof();
      const tampered = { ...proof, dayId: '2026-01-29' };
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject proof with earlier dayId', () => {
      const proof = getValidProof();
      const tampered = { ...proof, dayId: '2026-01-27' };
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject proof with empty dayId', () => {
      const proof = getValidProof();
      const tampered = { ...proof, dayId: '' };
      expect(verifyRewardProof(tampered)).toBe(false);
    });
  });

  describe('leaf tampering', () => {
    it('should reject proof with modified leaf', () => {
      const proof = getValidProof();
      const tampered = { ...proof, leaf: 'malicious-leaf-data' };
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject proof with empty leaf', () => {
      const proof = getValidProof();
      const tampered = { ...proof, leaf: '' };
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject proof with leaf from different day', () => {
      const proof = getValidProof();
      // Create leaf with different dayId but same account/amount
      const wrongDayLeaf = createLeaf('bob', 2_000_000n, '2026-01-29');
      const tampered = { ...proof, leaf: wrongDayLeaf };
      expect(verifyRewardProof(tampered)).toBe(false);
    });
  });

  describe('leafHash tampering', () => {
    it('should reject proof with wrong leafHash', () => {
      const proof = getValidProof();
      const tampered = { ...proof, leafHash: 'deadbeef'.repeat(8) };
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject proof with leafHash of different leaf', () => {
      const commitment = buildRewardCommitment(dayId, testRewards);
      const bobProof = commitment.getProof('bob')!;
      const aliceProof = commitment.getProof('alice')!;

      // Use bob's proof but alice's leafHash
      const tampered = { ...bobProof, leafHash: aliceProof.leafHash };
      expect(verifyRewardProof(tampered)).toBe(false);
    });
  });

  describe('proof path tampering', () => {
    it('should reject proof with modified sibling hash', () => {
      const proof = getValidProof();
      if (proof.proof.length === 0) return; // Skip if single-leaf tree

      const tampered = {
        ...proof,
        proof: [
          { ...proof.proof[0], hash: 'aaaa'.repeat(16) },
          ...proof.proof.slice(1),
        ],
      };
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject proof with flipped position', () => {
      const proof = getValidProof();
      if (proof.proof.length === 0) return;

      const tampered = {
        ...proof,
        proof: [
          {
            ...proof.proof[0],
            position: proof.proof[0].position === 'left' ? 'right' as const : 'left' as const,
          },
          ...proof.proof.slice(1),
        ],
      };
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject proof with missing proof step', () => {
      const proof = getValidProof();
      if (proof.proof.length === 0) return;

      const tampered = {
        ...proof,
        proof: proof.proof.slice(1), // Remove first step
      };
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject proof with extra proof step', () => {
      const proof = getValidProof();

      const tampered = {
        ...proof,
        proof: [
          ...proof.proof,
          { hash: 'bbbb'.repeat(16), position: 'left' as const },
        ],
      };
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject proof with reordered proof steps', () => {
      const proof = getValidProof();
      if (proof.proof.length < 2) return;

      const tampered = {
        ...proof,
        proof: [...proof.proof].reverse(),
      };
      expect(verifyRewardProof(tampered)).toBe(false);
    });
  });

  describe('root tampering', () => {
    it('should reject proof with wrong root', () => {
      const proof = getValidProof();
      const tampered = { ...proof, root: 'cccc'.repeat(16) };
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject proof with root from different day', () => {
      const commitment1 = buildRewardCommitment('2026-01-28', testRewards);
      const commitment2 = buildRewardCommitment('2026-01-29', testRewards);

      const proof = commitment1.getProof('bob')!;
      const tampered = { ...proof, root: commitment2.root };
      expect(verifyRewardProof(tampered)).toBe(false);
    });
  });

  describe('cross-account tampering', () => {
    it('should reject using another account proof path', () => {
      const commitment = buildRewardCommitment(dayId, testRewards);
      const bobProof = commitment.getProof('bob')!;
      const aliceProof = commitment.getProof('alice')!;

      // Try to use alice's proof path with bob's leaf data
      const tampered = {
        ...bobProof,
        proof: aliceProof.proof,
      };
      expect(verifyRewardProof(tampered)).toBe(false);
    });

    it('should reject mixing proofs from different commitments', () => {
      const rewards1: RewardEntry[] = [
        { accountId: 'alice', amountMicrounits: 1_000_000n },
        { accountId: 'bob', amountMicrounits: 2_000_000n },
      ];
      const rewards2: RewardEntry[] = [
        { accountId: 'alice', amountMicrounits: 5_000_000n }, // Different amount
        { accountId: 'bob', amountMicrounits: 2_000_000n },
      ];

      const commitment1 = buildRewardCommitment(dayId, rewards1);
      const commitment2 = buildRewardCommitment(dayId, rewards2);

      const proof1 = commitment1.getProof('alice')!;

      // Try to verify proof1 against commitment2's root
      const tampered = { ...proof1, root: commitment2.root };
      expect(verifyRewardProof(tampered)).toBe(false);
    });
  });
});
