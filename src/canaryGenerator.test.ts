/**
 * Unit tests for Canary Block Generator
 */

import {
  shouldBeCanary,
  seededRandom,
  createCanaryBlockTemplate,
  selectCanaryBlocks,
  isCanaryDistributionValid,
  CanaryConfig,
} from './canaryGenerator';
import { BlockType } from './types';

describe('seededRandom', () => {
  it('should generate deterministic random numbers', () => {
    const rng1 = seededRandom(12345);
    const rng2 = seededRandom(12345);

    // Same seed should produce same sequence
    expect(rng1()).toBe(rng2());
    expect(rng1()).toBe(rng2());
    expect(rng1()).toBe(rng2());
  });

  it('should generate different numbers for different seeds', () => {
    const rng1 = seededRandom(11111);
    const rng2 = seededRandom(22222);

    expect(rng1()).not.toBe(rng2());
  });

  it('should generate numbers between 0 and 1', () => {
    const rng = seededRandom(99999);
    for (let i = 0; i < 100; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('shouldBeCanary', () => {
  it('should always return false when canaryPercentage is 0', () => {
    const config: CanaryConfig = { canaryPercentage: 0 };

    expect(shouldBeCanary('block_1', config)).toBe(false);
    expect(shouldBeCanary('block_2', config)).toBe(false);
    expect(shouldBeCanary('block_3', config)).toBe(false);
  });

  it('should always return true when canaryPercentage is 1', () => {
    const config: CanaryConfig = { canaryPercentage: 1.0 };

    expect(shouldBeCanary('block_1', config)).toBe(true);
    expect(shouldBeCanary('block_2', config)).toBe(true);
    expect(shouldBeCanary('block_3', config)).toBe(true);
  });

  it('should be deterministic for same blockId', () => {
    const config: CanaryConfig = { canaryPercentage: 0.5 };

    const result1 = shouldBeCanary('block_abc', config);
    const result2 = shouldBeCanary('block_abc', config);
    const result3 = shouldBeCanary('block_abc', config);

    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
  });

  it('should produce different results for different blockIds', () => {
    const config: CanaryConfig = { canaryPercentage: 0.5 };

    const results = new Set();
    for (let i = 0; i < 100; i++) {
      results.add(shouldBeCanary(`block_${i}`, config));
    }

    // With 100 blocks and 50% probability, we should see both true and false
    expect(results.size).toBe(2);
    expect(results.has(true)).toBe(true);
    expect(results.has(false)).toBe(true);
  });

  it('should respect seed for reproducibility', () => {
    const config1: CanaryConfig = { canaryPercentage: 0.5, seed: 42 };
    const config2: CanaryConfig = { canaryPercentage: 0.5, seed: 42 };

    const results1 = [];
    const results2 = [];

    for (let i = 0; i < 10; i++) {
      results1.push(shouldBeCanary(`block_${i}`, config1));
      results2.push(shouldBeCanary(`block_${i}`, config2));
    }

    expect(results1).toEqual(results2);
  });

  it('should produce different results with different seeds', () => {
    const config1: CanaryConfig = { canaryPercentage: 0.5, seed: 111 };
    const config2: CanaryConfig = { canaryPercentage: 0.5, seed: 222 };

    let differences = 0;
    for (let i = 0; i < 20; i++) {
      const result1 = shouldBeCanary(`block_${i}`, config1);
      const result2 = shouldBeCanary(`block_${i}`, config2);
      if (result1 !== result2) {
        differences++;
      }
    }

    // Different seeds should produce some different results
    expect(differences).toBeGreaterThan(0);
  });

  it('should approximate target percentage over large sample', () => {
    const config: CanaryConfig = { canaryPercentage: 0.1, seed: 123 };

    let canaryCount = 0;
    const totalBlocks = 1000;

    for (let i = 0; i < totalBlocks; i++) {
      if (shouldBeCanary(`block_${i}`, config)) {
        canaryCount++;
      }
    }

    const actualPercentage = canaryCount / totalBlocks;

    // Should be within ±3% of target 10%
    expect(actualPercentage).toBeGreaterThan(0.07);
    expect(actualPercentage).toBeLessThan(0.13);
  });
});

describe('createCanaryBlockTemplate', () => {
  it('should create canary template with correct properties', () => {
    const template = createCanaryBlockTemplate('canary_001', BlockType.INFERENCE);

    expect(template.blockId).toBe('canary_001');
    expect(template.blockType).toBe(BlockType.INFERENCE);
    expect(template.isCanary).toBe(true);
  });

  it('should work with different block types', () => {
    const templates = [
      createCanaryBlockTemplate('c1', BlockType.INFERENCE),
      createCanaryBlockTemplate('c2', BlockType.EMBEDDINGS),
      createCanaryBlockTemplate('c3', BlockType.VALIDATION),
      createCanaryBlockTemplate('c4', BlockType.TRAINING),
    ];

    expect(templates[0].blockType).toBe(BlockType.INFERENCE);
    expect(templates[1].blockType).toBe(BlockType.EMBEDDINGS);
    expect(templates[2].blockType).toBe(BlockType.VALIDATION);
    expect(templates[3].blockType).toBe(BlockType.TRAINING);
    expect(templates.every(t => t.isCanary === true)).toBe(true);
  });
});

describe('selectCanaryBlocks', () => {
  it('should return empty array for empty input', () => {
    const result = selectCanaryBlocks([]);
    expect(result).toEqual([]);
  });

  it('should return subset of input blocks', () => {
    const blockIds = ['b1', 'b2', 'b3', 'b4', 'b5'];
    const canaries = selectCanaryBlocks(blockIds);

    // Every canary should be from the input
    canaries.forEach(canary => {
      expect(blockIds).toContain(canary);
    });
  });

  it('should be deterministic', () => {
    const blockIds = ['b1', 'b2', 'b3', 'b4', 'b5'];
    const config: CanaryConfig = { canaryPercentage: 0.5, seed: 42 };

    const result1 = selectCanaryBlocks(blockIds, config);
    const result2 = selectCanaryBlocks(blockIds, config);

    expect(result1).toEqual(result2);
  });

  it('should select approximately correct percentage', () => {
    const blockIds = Array.from({ length: 1000 }, (_, i) => `block_${i}`);
    const config: CanaryConfig = { canaryPercentage: 0.15, seed: 99 };

    const canaries = selectCanaryBlocks(blockIds, config);
    const actualPercentage = canaries.length / blockIds.length;

    // Should be within ±3% of target 15%
    expect(actualPercentage).toBeGreaterThan(0.12);
    expect(actualPercentage).toBeLessThan(0.18);
  });

  it('should use default config when none provided', () => {
    const blockIds = Array.from({ length: 10000 }, (_, i) => `block_${i}`);
    const canaries = selectCanaryBlocks(blockIds);

    // Should be roughly 10% (default) - with larger sample size
    const actualPercentage = canaries.length / blockIds.length;
    expect(actualPercentage).toBeGreaterThan(0.08);
    expect(actualPercentage).toBeLessThan(0.12);
  });
});

describe('isCanaryDistributionValid', () => {
  it('should return true for distribution within tolerance', () => {
    // 100 canaries out of 1000 blocks = 10%
    // Expected: 10%, Tolerance: ±5%
    expect(isCanaryDistributionValid(1000, 100, 0.10, 0.05)).toBe(true);
  });

  it('should return false for distribution outside tolerance', () => {
    // 200 canaries out of 1000 blocks = 20%
    // Expected: 10%, Tolerance: ±5% (range: 5%-15%)
    expect(isCanaryDistributionValid(1000, 200, 0.10, 0.05)).toBe(false);
  });

  it('should handle edge case: 0 total blocks', () => {
    expect(isCanaryDistributionValid(0, 0, 0.10, 0.05)).toBe(true);
    expect(isCanaryDistributionValid(0, 1, 0.10, 0.05)).toBe(false);
  });

  it('should handle exact matches', () => {
    // Exactly 10%
    expect(isCanaryDistributionValid(100, 10, 0.10, 0.05)).toBe(true);
  });

  it('should validate lower bound', () => {
    // 5 canaries out of 100 = 5%
    // Expected: 10%, Tolerance: ±5% (range: 5%-15%)
    expect(isCanaryDistributionValid(100, 5, 0.10, 0.05)).toBe(true);

    // 4 canaries out of 100 = 4%
    expect(isCanaryDistributionValid(100, 4, 0.10, 0.05)).toBe(false);
  });

  it('should validate upper bound', () => {
    // 15 canaries out of 100 = 15%
    // Expected: 10%, Tolerance: ±5% (range: 5%-15%)
    expect(isCanaryDistributionValid(100, 15, 0.10, 0.05)).toBe(true);

    // 16 canaries out of 100 = 16%
    expect(isCanaryDistributionValid(100, 16, 0.10, 0.05)).toBe(false);
  });

  it('should use default tolerance when not provided', () => {
    // Default tolerance is 5%
    expect(isCanaryDistributionValid(1000, 100, 0.10)).toBe(true);
    expect(isCanaryDistributionValid(1000, 200, 0.10)).toBe(false);
  });
});

describe('Canary System Integration', () => {
  it('should allow verifying which blocks were canaries after distribution', () => {
    // Scenario: System distributes 100 blocks to contributors
    const allBlockIds = Array.from({ length: 100 }, (_, i) => `block_${i}`);
    const config: CanaryConfig = { canaryPercentage: 0.1, seed: 42 };

    // System decides which are canaries
    const canaryBlockIds = selectCanaryBlocks(allBlockIds, config);

    // Later, system can verify if a specific block was a canary
    allBlockIds.forEach(blockId => {
      const wasCanary = shouldBeCanary(blockId, config);
      const isInCanaryList = canaryBlockIds.includes(blockId);
      expect(wasCanary).toBe(isInCanaryList);
    });
  });

  it('should demonstrate canary detection workflow', () => {
    const blockId = 'block_test_123';
    const config: CanaryConfig = { canaryPercentage: 0.1, seed: 777 };

    // Step 1: System checks if this block should be a canary
    const isCanary = shouldBeCanary(blockId, config);

    if (isCanary) {
      // Step 2: Create canary template with known answer
      const template = createCanaryBlockTemplate(blockId, BlockType.INFERENCE);
      expect(template.isCanary).toBe(true);

      // Step 3: Contributor completes block
      // (In real system, contributor's answer would be checked against known answer)
      // If wrong answer → canaryAnswerCorrect = false → 0 points
    }

    // This test just validates the workflow structure
    expect(typeof isCanary).toBe('boolean');
  });
});
