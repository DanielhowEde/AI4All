/**
 * Fixed-Point Arithmetic for Deterministic Token Calculations
 *
 * Uses bigint to represent token amounts in microunits (1 token = 1,000,000 microunits).
 * This provides deterministic, auditable calculations that are identical across all platforms.
 *
 * Why fixed-point?
 * - Floating-point has rounding errors that accumulate
 * - JavaScript Math.sqrt() is not deterministic across engines
 * - Fixed-point ensures exact reproducibility for auditing
 * - Required for mainnet with real money
 */

/**
 * Microunits per token (1 token = 1,000,000 microunits)
 * Provides 6 decimal places of precision
 */
export const MICRO_UNITS = 1_000_000n;

/**
 * Maximum safe token amount (~9 trillion tokens)
 * This is well beyond any realistic token supply
 */
export const MAX_SAFE_TOKENS = 9_007_199_254_740_991n; // Number.MAX_SAFE_INTEGER

/**
 * Convert tokens (as number) to microunits (as bigint)
 *
 * @param tokens Token amount as floating-point number
 * @returns Microunits as bigint
 * @throws Error if tokens is negative or exceeds MAX_SAFE_TOKENS
 */
export function toMicroUnits(tokens: number): bigint {
  if (tokens < 0) {
    throw new Error(`Cannot convert negative tokens: ${tokens}`);
  }

  if (tokens > Number(MAX_SAFE_TOKENS)) {
    throw new Error(`Token amount exceeds maximum safe value: ${tokens}`);
  }

  // Multiply by MICRO_UNITS and round to nearest integer
  const microUnits = BigInt(Math.round(tokens * Number(MICRO_UNITS)));
  return microUnits;
}

/**
 * Convert microunits (as bigint) to tokens (as number)
 *
 * @param microUnits Microunit amount as bigint
 * @returns Token amount as floating-point number
 */
export function toTokens(microUnits: bigint): number {
  return Number(microUnits) / Number(MICRO_UNITS);
}

/**
 * Integer square root using Newton's method
 *
 * Computes floor(sqrt(n)) using only integer arithmetic.
 * This is deterministic and gives the same result on all platforms.
 *
 * Algorithm: Start with initial guess, iteratively improve using:
 * x_{n+1} = (x_n + n / x_n) / 2
 *
 * @param n Value to take square root of (in microunits)
 * @returns Integer square root (in microunits)
 */
export function sqrtBigInt(n: bigint): bigint {
  if (n < 0n) {
    throw new Error(`Cannot take square root of negative number: ${n}`);
  }

  if (n === 0n) {
    return 0n;
  }

  if (n < 4n) {
    return 1n;
  }

  // Initial guess: use bit manipulation for fast approximation
  // Start with 2^(bitLength/2)
  let x = n;
  let y = (x + 1n) / 2n;

  // Newton's method: iterate until convergence
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }

  return x;
}

/**
 * Calculate sqrt of points value (in microunits)
 *
 * Takes a point value in microunits and returns sqrt(points) in microunits.
 *
 * Example:
 * - Input: 100_000_000 (100 tokens worth of points)
 * - Output: 10_000_000 (sqrt(100) = 10, in microunits)
 *
 * Algorithm:
 * 1. Divide points by MICRO_UNITS to get raw value (100_000_000 / 1_000_000 = 100)
 * 2. Take sqrt of raw value: sqrt(100) = 10
 * 3. Multiply result by MICRO_UNITS to convert back: 10 * 1_000_000 = 10_000_000
 *
 * For precision, we use: sqrt(points) * sqrt(MICRO_UNITS) / sqrt(MICRO_UNITS) * MICRO_UNITS
 * Simplified: sqrt(points * MICRO_UNITS^2) / MICRO_UNITS
 *
 * @param pointsMicroUnits Point value in microunits
 * @returns sqrt(points) in microunits
 */
export function sqrtPoints(pointsMicroUnits: bigint): bigint {
  if (pointsMicroUnits === 0n) {
    return 0n;
  }

  // Scale up for precision: points * MICRO_UNITS^2
  // Then sqrt and divide by MICRO_UNITS
  // This gives us sqrt(points) * MICRO_UNITS
  const scaled = pointsMicroUnits * MICRO_UNITS; // Scale by additional MICRO_UNITS
  const sqrtScaled = sqrtBigInt(scaled);

  return sqrtScaled;
}

/**
 * Proportional distribution with deterministic remainder handling
 *
 * Distributes a pool amount proportionally based on weights, ensuring:
 * 1. Sum of distributed amounts exactly equals pool amount
 * 2. Distribution is deterministic (same inputs = same outputs)
 * 3. Remainder is distributed fairly (largest fractional parts first)
 *
 * Algorithm:
 * 1. Calculate each share: floor(weight * poolAmount / totalWeight)
 * 2. Sum the shares and calculate remainder
 * 3. Sort by fractional part (descending)
 * 4. Distribute remainder one microunit at a time to largest fractions
 *
 * @param weights Array of weights (in microunits)
 * @param poolAmount Total amount to distribute (in microunits)
 * @returns Array of distributed amounts (same order as weights)
 */
export function distributeProportional(
  weights: bigint[],
  poolAmount: bigint
): bigint[] {
  if (weights.length === 0) {
    return [];
  }

  if (poolAmount < 0n) {
    throw new Error(`Pool amount cannot be negative: ${poolAmount}`);
  }

  if (poolAmount === 0n) {
    return weights.map(() => 0n);
  }

  // Calculate total weight
  const totalWeight = weights.reduce((sum, w) => sum + w, 0n);

  if (totalWeight === 0n) {
    // Equal distribution if no one has weight
    const equalShare = poolAmount / BigInt(weights.length);
    const remainder = poolAmount % BigInt(weights.length);

    return weights.map((_, index) => {
      // Give remainder to first N contributors
      return equalShare + (BigInt(index) < remainder ? 1n : 0n);
    });
  }

  // Calculate base shares (floor division)
  const shares = weights.map(weight =>
    (weight * poolAmount) / totalWeight
  );

  // Calculate remainder
  const distributed = shares.reduce((sum, share) => sum + share, 0n);
  let remainder = poolAmount - distributed;

  // Calculate fractional parts for fair remainder distribution
  // fractional = (weight * poolAmount) % totalWeight
  const fractionals = weights.map((weight, index) => ({
    index,
    fractional: (weight * poolAmount) % totalWeight
  }));

  // Sort by fractional part (descending) for deterministic distribution
  // In case of tie, use index for determinism
  fractionals.sort((a, b) => {
    if (b.fractional !== a.fractional) {
      return Number(b.fractional - a.fractional);
    }
    return a.index - b.index;
  });

  // Distribute remainder one microunit at a time
  for (const { index } of fractionals) {
    if (remainder === 0n) break;
    shares[index] += 1n;
    remainder -= 1n;
  }

  // Verify exact distribution (should always be true)
  const finalSum = shares.reduce((sum, share) => sum + share, 0n);
  if (finalSum !== poolAmount) {
    throw new Error(
      `Distribution error: sum (${finalSum}) != pool (${poolAmount}). ` +
      `This should never happen - please report this bug.`
    );
  }

  return shares;
}

/**
 * Calculate sqrt-weighted shares for performance pool distribution
 *
 * Takes an array of point values, calculates sqrt weights, and returns
 * proportional shares of the pool amount.
 *
 * @param points Array of point values (in microunits)
 * @param poolAmount Total pool to distribute (in microunits)
 * @returns Array of distributed amounts (in microunits)
 */
export function distributeSqrtWeighted(
  points: bigint[],
  poolAmount: bigint
): bigint[] {
  if (points.length === 0) {
    return [];
  }

  // Calculate sqrt weights
  const weights = points.map(p => sqrtPoints(p));

  // Distribute proportionally
  return distributeProportional(weights, poolAmount);
}

/**
 * Format microunits as human-readable token string
 *
 * @param microUnits Amount in microunits
 * @param decimals Number of decimal places to show (default: 6)
 * @returns Formatted string (e.g., "1000.123456")
 */
export function formatTokens(microUnits: bigint, decimals: number = 6): string {
  const tokens = toTokens(microUnits);
  return tokens.toFixed(decimals);
}

/**
 * Verify distribution correctness
 *
 * Helper function for testing. Verifies that:
 * 1. Sum of shares equals total
 * 2. Each share is non-negative
 * 3. Each share is <= total
 *
 * @param shares Distributed amounts
 * @param total Expected total
 * @returns true if valid, false otherwise
 */
export function verifyDistribution(shares: bigint[], total: bigint): boolean {
  if (shares.length === 0 && total === 0n) {
    return true;
  }

  const sum = shares.reduce((acc, share) => acc + share, 0n);

  if (sum !== total) {
    console.error(`Sum mismatch: ${sum} !== ${total}`);
    return false;
  }

  for (const share of shares) {
    if (share < 0n) {
      console.error(`Negative share: ${share}`);
      return false;
    }
    if (share > total) {
      console.error(`Share exceeds total: ${share} > ${total}`);
      return false;
    }
  }

  return true;
}
