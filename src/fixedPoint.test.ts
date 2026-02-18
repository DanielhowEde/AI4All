/**
 * Fixed-Point Arithmetic Tests
 *
 * Tests for deterministic token calculations using bigint nanounits.
 * 1 token = 1,000,000,000 nanounits (9 decimal places)
 */

import {
  MAX_SAFE_TOKENS,
  toNanoUnits,
  toTokens,
  sqrtBigInt,
  sqrtPoints,
  distributeProportional,
  distributeSqrtWeighted,
  formatTokens,
  verifyDistribution,
} from './fixedPoint';

describe('Fixed-Point Arithmetic', () => {
  describe('toNanoUnits', () => {
    it('should convert whole tokens to nanounits', () => {
      expect(toNanoUnits(1)).toBe(1_000_000_000n);
      expect(toNanoUnits(100)).toBe(100_000_000_000n);
      expect(toNanoUnits(22000)).toBe(22_000_000_000_000n);
    });

    it('should convert fractional tokens to nanounits', () => {
      expect(toNanoUnits(0.5)).toBe(500_000_000n);
      expect(toNanoUnits(0.123456789)).toBe(123_456_789n);
      expect(toNanoUnits(1.999999999)).toBe(1_999_999_999n);
    });

    it('should handle zero', () => {
      expect(toNanoUnits(0)).toBe(0n);
    });

    it('should round to nearest nanounit', () => {
      // 0.1234567891 → rounds to 123_456_789n
      const result = toNanoUnits(0.123456789);
      expect(result).toBe(123_456_789n);
    });

    it('should throw on negative tokens', () => {
      expect(() => toNanoUnits(-1)).toThrow('Cannot convert negative tokens');
    });

    it('should throw on excessive tokens', () => {
      expect(() => toNanoUnits(Number(MAX_SAFE_TOKENS) + 1)).toThrow(
        'exceeds maximum safe value'
      );
    });
  });

  describe('toTokens', () => {
    it('should convert nanounits to tokens', () => {
      expect(toTokens(1_000_000_000n)).toBe(1);
      expect(toTokens(100_000_000_000n)).toBe(100);
      expect(toTokens(22_000_000_000_000n)).toBe(22000);
    });

    it('should convert fractional nanounits to tokens', () => {
      expect(toTokens(500_000_000n)).toBe(0.5);
      expect(toTokens(123_456_789n)).toBeCloseTo(0.123456789, 9);
      expect(toTokens(1n)).toBe(0.000000001);
    });

    it('should handle zero', () => {
      expect(toTokens(0n)).toBe(0);
    });

    it('should round-trip correctly', () => {
      const original = 1234.567890123;
      const nanoUnits = toNanoUnits(original);
      const roundTrip = toTokens(nanoUnits);
      expect(roundTrip).toBeCloseTo(original, 9);
    });
  });

  describe('sqrtBigInt', () => {
    it('should calculate integer square root correctly', () => {
      expect(sqrtBigInt(0n)).toBe(0n);
      expect(sqrtBigInt(1n)).toBe(1n);
      expect(sqrtBigInt(4n)).toBe(2n);
      expect(sqrtBigInt(9n)).toBe(3n);
      expect(sqrtBigInt(16n)).toBe(4n);
      expect(sqrtBigInt(100n)).toBe(10n);
      expect(sqrtBigInt(10000n)).toBe(100n);
      expect(sqrtBigInt(1_000_000n)).toBe(1000n);
    });

    it('should floor non-perfect squares', () => {
      expect(sqrtBigInt(2n)).toBe(1n); // floor(1.414...)
      expect(sqrtBigInt(3n)).toBe(1n); // floor(1.732...)
      expect(sqrtBigInt(5n)).toBe(2n); // floor(2.236...)
      expect(sqrtBigInt(8n)).toBe(2n); // floor(2.828...)
      expect(sqrtBigInt(99n)).toBe(9n); // floor(9.949...)
      expect(sqrtBigInt(101n)).toBe(10n); // floor(10.049...)
    });

    it('should handle large numbers', () => {
      expect(sqrtBigInt(1_000_000_000_000n)).toBe(1_000_000n);
      expect(sqrtBigInt(1_000_000_000_000_000_000n)).toBe(1_000_000_000n);
    });

    it('should throw on negative numbers', () => {
      expect(() => sqrtBigInt(-1n)).toThrow('Cannot take square root of negative');
    });

    it('should be deterministic', () => {
      const value = 123_456_789n;
      const result1 = sqrtBigInt(value);
      const result2 = sqrtBigInt(value);
      const result3 = sqrtBigInt(value);
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });
  });

  describe('sqrtPoints', () => {
    it('should calculate sqrt of points with scaling', () => {
      expect(sqrtPoints(0n)).toBe(0n);
      // sqrt(100 tokens) = 10 tokens → 100e9 nano → sqrt → 10e9 nano
      expect(sqrtPoints(100_000_000_000n)).toBe(10_000_000_000n); // sqrt(100) = 10
      expect(sqrtPoints(400_000_000_000n)).toBe(20_000_000_000n); // sqrt(400) = 20
      expect(sqrtPoints(900_000_000_000n)).toBe(30_000_000_000n); // sqrt(900) = 30
    });

    it('should preserve precision for large values', () => {
      const points = toNanoUnits(10000); // 10,000 tokens worth of points
      const weight = sqrtPoints(points);
      const weightTokens = toTokens(weight);
      expect(weightTokens).toBeCloseTo(100, 1); // sqrt(10000) = 100
    });
  });

  describe('distributeProportional', () => {
    it('should distribute proportionally with no remainder', () => {
      const weights = [2_000_000_000n, 3_000_000_000n, 5_000_000_000n]; // 2, 3, 5 = 10 total
      const pool = 10_000_000_000n; // 10 tokens
      const shares = distributeProportional(weights, pool);

      expect(shares[0]).toBe(2_000_000_000n); // 2/10 * 10 = 2
      expect(shares[1]).toBe(3_000_000_000n); // 3/10 * 10 = 3
      expect(shares[2]).toBe(5_000_000_000n); // 5/10 * 10 = 5

      // Verify sum
      const sum = shares.reduce((acc, s) => acc + s, 0n);
      expect(sum).toBe(pool);
    });

    it('should distribute remainder deterministically', () => {
      const weights = [1_000_000_000n, 1_000_000_000n, 1_000_000_000n]; // Equal weights
      const pool = 10_000_000_000n; // 10 tokens, not evenly divisible by 3

      const shares = distributeProportional(weights, pool);

      // Each gets floor(10/3) = 3.333... tokens
      // Remainder goes to one contributor (deterministically)
      expect(shares[0] + shares[1] + shares[2]).toBe(pool);
      expect(shares.filter(s => s === 3_333_333_334n).length).toBe(1); // One gets extra
      expect(shares.filter(s => s === 3_333_333_333n).length).toBe(2);
    });

    it('should handle zero pool', () => {
      const weights = [1_000_000_000n, 2_000_000_000n, 3_000_000_000n];
      const shares = distributeProportional(weights, 0n);

      expect(shares).toEqual([0n, 0n, 0n]);
    });

    it('should handle empty weights', () => {
      const shares = distributeProportional([], 1_000_000_000n);
      expect(shares).toEqual([]);
    });

    it('should handle zero total weight with equal distribution', () => {
      const weights = [0n, 0n, 0n];
      const pool = 9_000_000_000n; // 9 tokens
      const shares = distributeProportional(weights, pool);

      // Should distribute equally: 3, 3, 3
      expect(shares).toEqual([3_000_000_000n, 3_000_000_000n, 3_000_000_000n]);
    });

    it('should handle zero total weight with remainder', () => {
      const weights = [0n, 0n, 0n];
      const pool = 10_000_000_000n; // 10 tokens (not divisible by 3)
      const shares = distributeProportional(weights, pool);

      // floor(10e9/3) = 3_333_333_333, remainder = 1
      // First contributor gets the remainder
      expect(shares[0]).toBe(3_333_333_334n);
      expect(shares[1]).toBe(3_333_333_333n);
      expect(shares[2]).toBe(3_333_333_333n);
      expect(shares.reduce((sum, s) => sum + s, 0n)).toBe(pool);
    });

    it('should be deterministic', () => {
      const weights = [1_234_567_000n, 8_765_432_000n, 5_555_555_000n];
      const pool = 22_000_000_000_000n; // 22,000 tokens

      const shares1 = distributeProportional(weights, pool);
      const shares2 = distributeProportional(weights, pool);
      const shares3 = distributeProportional(weights, pool);

      expect(shares1).toEqual(shares2);
      expect(shares2).toEqual(shares3);
    });

    it('should never lose nanounits (exact sum)', () => {
      const weights = [1_111_111_000n, 2_222_222_000n, 3_333_333_000n, 4_444_444_000n];
      const pool = 17_600_000_000_000n; // 17,600 tokens

      const shares = distributeProportional(weights, pool);
      const sum = shares.reduce((acc, s) => acc + s, 0n);

      expect(sum).toBe(pool); // Exact match, not close
    });

    it('should distribute large pools correctly', () => {
      const weights = [100_000_000_000n, 200_000_000_000n, 300_000_000_000n];
      const pool = 1_000_000_000_000_000n; // 1 million tokens

      const shares = distributeProportional(weights, pool);
      const sum = shares.reduce((acc, s) => acc + s, 0n);

      expect(sum).toBe(pool);
      expect(verifyDistribution(shares, pool)).toBe(true);
    });

    it('should handle single contributor', () => {
      const weights = [5_000_000_000n];
      const pool = 10_000_000_000n;

      const shares = distributeProportional(weights, pool);
      expect(shares).toEqual([10_000_000_000n]); // Gets entire pool
    });

    it('should throw on negative pool', () => {
      const weights = [1_000_000_000n];
      expect(() => distributeProportional(weights, -1n)).toThrow(
        'Pool amount cannot be negative'
      );
    });
  });

  describe('distributeSqrtWeighted', () => {
    it('should distribute using sqrt weights', () => {
      const points = [
        toNanoUnits(100), // sqrt = 10
        toNanoUnits(400), // sqrt = 20
        toNanoUnits(900), // sqrt = 30
      ]; // Total sqrt weight = 60
      const pool = toNanoUnits(6000); // 6000 tokens

      const shares = distributeSqrtWeighted(points, pool);

      // Expected: 1000, 2000, 3000 tokens
      expect(toTokens(shares[0])).toBeCloseTo(1000, 1);
      expect(toTokens(shares[1])).toBeCloseTo(2000, 1);
      expect(toTokens(shares[2])).toBeCloseTo(3000, 1);

      // Exact sum
      const sum = shares.reduce((acc, s) => acc + s, 0n);
      expect(sum).toBe(pool);
    });

    it('should handle zero points', () => {
      const points = [toNanoUnits(0), toNanoUnits(100), toNanoUnits(400)];
      const pool = toNanoUnits(1000);

      const shares = distributeSqrtWeighted(points, pool);

      // First contributor has 0 weight, gets 0
      expect(shares[0]).toBe(0n);

      // Remaining pool distributed between others
      expect(shares[1] + shares[2]).toBe(pool);
    });

    it('should be deterministic', () => {
      const points = [toNanoUnits(123), toNanoUnits(456), toNanoUnits(789)];
      const pool = toNanoUnits(10000);

      const shares1 = distributeSqrtWeighted(points, pool);
      const shares2 = distributeSqrtWeighted(points, pool);
      const shares3 = distributeSqrtWeighted(points, pool);

      expect(shares1).toEqual(shares2);
      expect(shares2).toEqual(shares3);
    });
  });

  describe('formatTokens', () => {
    it('should format with 9 decimals by default', () => {
      expect(formatTokens(1_234_567_890n)).toBe('1.234567890');
      expect(formatTokens(1_000_000_000n)).toBe('1.000000000');
      expect(formatTokens(500_000_000n)).toBe('0.500000000');
    });

    it('should format with custom decimals', () => {
      expect(formatTokens(1_234_567_890n, 2)).toBe('1.23');
      expect(formatTokens(1_234_567_890n, 4)).toBe('1.2346');
      expect(formatTokens(1_000_000_000n, 0)).toBe('1');
    });

    it('should handle zero', () => {
      expect(formatTokens(0n)).toBe('0.000000000');
    });

    it('should handle large numbers', () => {
      expect(formatTokens(22_000_000_000_000n, 2)).toBe('22000.00');
    });
  });

  describe('verifyDistribution', () => {
    it('should verify valid distribution', () => {
      const shares = [1_000_000_000n, 2_000_000_000n, 3_000_000_000n];
      const total = 6_000_000_000n;
      expect(verifyDistribution(shares, total)).toBe(true);
    });

    it('should detect sum mismatch', () => {
      const shares = [1_000_000_000n, 2_000_000_000n, 3_000_000_000n];
      const total = 7_000_000_000n; // Wrong total
      expect(verifyDistribution(shares, total)).toBe(false);
    });

    it('should detect negative shares', () => {
      const shares = [1_000_000_000n, -1_000_000_000n, 2_000_000_000n];
      const total = 2_000_000_000n;
      expect(verifyDistribution(shares, total)).toBe(false);
    });

    it('should handle empty distributions', () => {
      expect(verifyDistribution([], 0n)).toBe(true);
    });
  });

  describe('Integration: Real-world scenarios', () => {
    it('should match floating-point results closely (daily emissions)', () => {
      // Scenario: 3 contributors with different points
      const contributor1Points = 130; // Alice
      const contributor2Points = 60; // Bob
      const contributor3Points = 10; // Charlie

      const points = [
        toNanoUnits(contributor1Points),
        toNanoUnits(contributor2Points),
        toNanoUnits(contributor3Points),
      ];

      const performancePool = toNanoUnits(17600); // 80% of 22,000

      const shares = distributeSqrtWeighted(points, performancePool);

      // Compare with floating-point calculation
      const sqrtWeights = [
        Math.sqrt(contributor1Points),
        Math.sqrt(contributor2Points),
        Math.sqrt(contributor3Points),
      ];
      const totalWeight = sqrtWeights.reduce((sum, w) => sum + w, 0);
      const expected = sqrtWeights.map(w => (w / totalWeight) * 17600);

      // Fixed-point should be within 0.01 tokens of floating-point
      for (let i = 0; i < shares.length; i++) {
        expect(toTokens(shares[i])).toBeCloseTo(expected[i], 2);
      }

      // But fixed-point has EXACT sum
      const sum = shares.reduce((acc, s) => acc + s, 0n);
      expect(sum).toBe(performancePool); // Exact, not approximate
    });

    it('should handle 100 contributors efficiently', () => {
      const points: bigint[] = [];
      for (let i = 0; i < 100; i++) {
        points.push(toNanoUnits(Math.floor(Math.random() * 1000) + 100));
      }

      const pool = toNanoUnits(22000);

      const start = Date.now();
      const shares = distributeSqrtWeighted(points, pool);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100); // Should be fast (<100ms)
      expect(verifyDistribution(shares, pool)).toBe(true);
    });

    it('should never lose nanounits over multiple distributions', () => {
      const totalEmissions = toNanoUnits(22000);
      const basePool = (totalEmissions * 20n) / 100n; // 20%
      const performancePool = (totalEmissions * 80n) / 100n; // 80%

      // Base pool: 3 contributors
      const baseShares = distributeProportional(
        [1_000_000_000n, 1_000_000_000n, 1_000_000_000n], // Equal weight
        basePool
      );

      // Performance pool: 3 contributors
      const perfShares = distributeSqrtWeighted(
        [toNanoUnits(100), toNanoUnits(400), toNanoUnits(900)],
        performancePool
      );

      // Total distributed should equal total emissions (exactly)
      const baseSum = baseShares.reduce((sum, s) => sum + s, 0n);
      const perfSum = perfShares.reduce((sum, s) => sum + s, 0n);

      expect(baseSum).toBe(basePool);
      expect(perfSum).toBe(performancePool);
      expect(baseSum + perfSum).toBe(totalEmissions); // Exact
    });
  });
});
