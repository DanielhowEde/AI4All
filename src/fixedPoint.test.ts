/**
 * Fixed-Point Arithmetic Tests
 *
 * Tests for deterministic token calculations using bigint microunits.
 */

import {
  MAX_SAFE_TOKENS,
  toMicroUnits,
  toTokens,
  sqrtBigInt,
  sqrtPoints,
  distributeProportional,
  distributeSqrtWeighted,
  formatTokens,
  verifyDistribution,
} from './fixedPoint';

describe('Fixed-Point Arithmetic', () => {
  describe('toMicroUnits', () => {
    it('should convert whole tokens to microunits', () => {
      expect(toMicroUnits(1)).toBe(1_000_000n);
      expect(toMicroUnits(100)).toBe(100_000_000n);
      expect(toMicroUnits(22000)).toBe(22_000_000_000n);
    });

    it('should convert fractional tokens to microunits', () => {
      expect(toMicroUnits(0.5)).toBe(500_000n);
      expect(toMicroUnits(0.123456)).toBe(123_456n);
      expect(toMicroUnits(1.999999)).toBe(1_999_999n);
    });

    it('should handle zero', () => {
      expect(toMicroUnits(0)).toBe(0n);
    });

    it('should round to nearest microunit', () => {
      expect(toMicroUnits(0.1234567)).toBe(123_457n); // Rounds up
      expect(toMicroUnits(0.1234564)).toBe(123_456n); // Rounds down
    });

    it('should throw on negative tokens', () => {
      expect(() => toMicroUnits(-1)).toThrow('Cannot convert negative tokens');
    });

    it('should throw on excessive tokens', () => {
      expect(() => toMicroUnits(Number(MAX_SAFE_TOKENS) + 1)).toThrow(
        'exceeds maximum safe value'
      );
    });
  });

  describe('toTokens', () => {
    it('should convert microunits to tokens', () => {
      expect(toTokens(1_000_000n)).toBe(1);
      expect(toTokens(100_000_000n)).toBe(100);
      expect(toTokens(22_000_000_000n)).toBe(22000);
    });

    it('should convert fractional microunits to tokens', () => {
      expect(toTokens(500_000n)).toBe(0.5);
      expect(toTokens(123_456n)).toBe(0.123456);
      expect(toTokens(1n)).toBe(0.000001);
    });

    it('should handle zero', () => {
      expect(toTokens(0n)).toBe(0);
    });

    it('should round-trip correctly', () => {
      const original = 1234.567890;
      const microUnits = toMicroUnits(original);
      const roundTrip = toTokens(microUnits);
      expect(roundTrip).toBeCloseTo(original, 6);
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
      expect(sqrtBigInt(9_999_999_999_999n)).toBe(3_162_277n);
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
      expect(sqrtPoints(100_000_000n)).toBe(10_000_000n); // sqrt(100) = 10
      expect(sqrtPoints(400_000_000n)).toBe(20_000_000n); // sqrt(400) = 20
      expect(sqrtPoints(900_000_000n)).toBe(30_000_000n); // sqrt(900) = 30
    });

    it('should preserve precision for large values', () => {
      const points = toMicroUnits(10000); // 10,000 tokens worth of points
      const weight = sqrtPoints(points);
      const weightTokens = toTokens(weight);
      expect(weightTokens).toBeCloseTo(100, 1); // sqrt(10000) = 100
    });
  });

  describe('distributeProportional', () => {
    it('should distribute proportionally with no remainder', () => {
      const weights = [2_000_000n, 3_000_000n, 5_000_000n]; // 2, 3, 5 = 10 total
      const pool = 10_000_000n; // 10 tokens
      const shares = distributeProportional(weights, pool);

      expect(shares[0]).toBe(2_000_000n); // 2/10 * 10 = 2
      expect(shares[1]).toBe(3_000_000n); // 3/10 * 10 = 3
      expect(shares[2]).toBe(5_000_000n); // 5/10 * 10 = 5

      // Verify sum
      const sum = shares.reduce((acc, s) => acc + s, 0n);
      expect(sum).toBe(pool);
    });

    it('should distribute remainder deterministically', () => {
      const weights = [1_000_000n, 1_000_000n, 1_000_000n]; // Equal weights
      const pool = 10_000_000n; // 10 tokens, not evenly divisible by 3

      const shares = distributeProportional(weights, pool);

      // Each gets floor(10/3) = 3.333... = 3 tokens
      // Remainder of 1 token goes to one contributor (deterministically)
      expect(shares[0] + shares[1] + shares[2]).toBe(pool);
      expect(shares.filter(s => s === 3_333_334n).length).toBe(1); // One gets extra
      expect(shares.filter(s => s === 3_333_333n).length).toBe(2);
    });

    it('should handle zero pool', () => {
      const weights = [1_000_000n, 2_000_000n, 3_000_000n];
      const shares = distributeProportional(weights, 0n);

      expect(shares).toEqual([0n, 0n, 0n]);
    });

    it('should handle empty weights', () => {
      const shares = distributeProportional([], 1_000_000n);
      expect(shares).toEqual([]);
    });

    it('should handle zero total weight with equal distribution', () => {
      const weights = [0n, 0n, 0n];
      const pool = 9_000_000n; // 9 tokens
      const shares = distributeProportional(weights, pool);

      // Should distribute equally: 3, 3, 3
      expect(shares).toEqual([3_000_000n, 3_000_000n, 3_000_000n]);
    });

    it('should handle zero total weight with remainder', () => {
      const weights = [0n, 0n, 0n];
      const pool = 10_000_000n; // 10 tokens (not divisible by 3)
      const shares = distributeProportional(weights, pool);

      // floor(10/3) = 3, remainder = 1
      // First contributor gets the remainder
      expect(shares[0]).toBe(3_333_334n);
      expect(shares[1]).toBe(3_333_333n);
      expect(shares[2]).toBe(3_333_333n);
      expect(shares.reduce((sum, s) => sum + s, 0n)).toBe(pool);
    });

    it('should be deterministic', () => {
      const weights = [1_234_567n, 8_765_432n, 5_555_555n];
      const pool = 22_000_000_000n; // 22,000 tokens

      const shares1 = distributeProportional(weights, pool);
      const shares2 = distributeProportional(weights, pool);
      const shares3 = distributeProportional(weights, pool);

      expect(shares1).toEqual(shares2);
      expect(shares2).toEqual(shares3);
    });

    it('should never lose microunits (exact sum)', () => {
      const weights = [1_111_111n, 2_222_222n, 3_333_333n, 4_444_444n];
      const pool = 17_600_000_000n; // 17,600 tokens

      const shares = distributeProportional(weights, pool);
      const sum = shares.reduce((acc, s) => acc + s, 0n);

      expect(sum).toBe(pool); // Exact match, not close
    });

    it('should distribute large pools correctly', () => {
      const weights = [100_000_000n, 200_000_000n, 300_000_000n];
      const pool = 1_000_000_000_000n; // 1 million tokens

      const shares = distributeProportional(weights, pool);
      const sum = shares.reduce((acc, s) => acc + s, 0n);

      expect(sum).toBe(pool);
      expect(verifyDistribution(shares, pool)).toBe(true);
    });

    it('should handle single contributor', () => {
      const weights = [5_000_000n];
      const pool = 10_000_000n;

      const shares = distributeProportional(weights, pool);
      expect(shares).toEqual([10_000_000n]); // Gets entire pool
    });

    it('should throw on negative pool', () => {
      const weights = [1_000_000n];
      expect(() => distributeProportional(weights, -1n)).toThrow(
        'Pool amount cannot be negative'
      );
    });
  });

  describe('distributeSqrtWeighted', () => {
    it('should distribute using sqrt weights', () => {
      const points = [
        toMicroUnits(100), // sqrt = 10
        toMicroUnits(400), // sqrt = 20
        toMicroUnits(900), // sqrt = 30
      ]; // Total sqrt weight = 60
      const pool = toMicroUnits(6000); // 6000 tokens

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
      const points = [toMicroUnits(0), toMicroUnits(100), toMicroUnits(400)];
      const pool = toMicroUnits(1000);

      const shares = distributeSqrtWeighted(points, pool);

      // First contributor has 0 weight, gets 0
      expect(shares[0]).toBe(0n);

      // Remaining pool distributed between others
      expect(shares[1] + shares[2]).toBe(pool);
    });

    it('should be deterministic', () => {
      const points = [toMicroUnits(123), toMicroUnits(456), toMicroUnits(789)];
      const pool = toMicroUnits(10000);

      const shares1 = distributeSqrtWeighted(points, pool);
      const shares2 = distributeSqrtWeighted(points, pool);
      const shares3 = distributeSqrtWeighted(points, pool);

      expect(shares1).toEqual(shares2);
      expect(shares2).toEqual(shares3);
    });
  });

  describe('formatTokens', () => {
    it('should format with 6 decimals by default', () => {
      expect(formatTokens(1_234_567n)).toBe('1.234567');
      expect(formatTokens(1_000_000n)).toBe('1.000000');
      expect(formatTokens(500_000n)).toBe('0.500000');
    });

    it('should format with custom decimals', () => {
      expect(formatTokens(1_234_567n, 2)).toBe('1.23');
      expect(formatTokens(1_234_567n, 4)).toBe('1.2346');
      expect(formatTokens(1_000_000n, 0)).toBe('1');
    });

    it('should handle zero', () => {
      expect(formatTokens(0n)).toBe('0.000000');
    });

    it('should handle large numbers', () => {
      expect(formatTokens(22_000_000_000n, 2)).toBe('22000.00');
    });
  });

  describe('verifyDistribution', () => {
    it('should verify valid distribution', () => {
      const shares = [1_000_000n, 2_000_000n, 3_000_000n];
      const total = 6_000_000n;
      expect(verifyDistribution(shares, total)).toBe(true);
    });

    it('should detect sum mismatch', () => {
      const shares = [1_000_000n, 2_000_000n, 3_000_000n];
      const total = 7_000_000n; // Wrong total
      expect(verifyDistribution(shares, total)).toBe(false);
    });

    it('should detect negative shares', () => {
      const shares = [1_000_000n, -1_000_000n, 2_000_000n];
      const total = 2_000_000n;
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
        toMicroUnits(contributor1Points),
        toMicroUnits(contributor2Points),
        toMicroUnits(contributor3Points),
      ];

      const performancePool = toMicroUnits(17600); // 80% of 22,000

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
        points.push(toMicroUnits(Math.floor(Math.random() * 1000) + 100));
      }

      const pool = toMicroUnits(22000);

      const start = Date.now();
      const shares = distributeSqrtWeighted(points, pool);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100); // Should be fast (<100ms)
      expect(verifyDistribution(shares, pool)).toBe(true);
    });

    it('should never lose microunits over multiple distributions', () => {
      const totalEmissions = toMicroUnits(22000);
      const basePool = (totalEmissions * 20n) / 100n; // 20%
      const performancePool = (totalEmissions * 80n) / 100n; // 80%

      // Base pool: 3 contributors
      const baseShares = distributeProportional(
        [1_000_000n, 1_000_000n, 1_000_000n], // Equal weight
        basePool
      );

      // Performance pool: 3 contributors
      const perfShares = distributeSqrtWeighted(
        [toMicroUnits(100), toMicroUnits(400), toMicroUnits(900)],
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
