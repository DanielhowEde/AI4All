/**
 * AI4All Reward Distribution System - Canary Block Generator
 * v1.0
 *
 * Canary blocks are honeypot blocks used to detect gaming/cheating.
 * They look like normal blocks but have a known-correct answer.
 */

import { BlockType, CompletedBlock } from './types';

/**
 * Configuration for canary block generation
 */
export interface CanaryConfig {
  /**
   * Percentage of blocks that should be canaries (0-1)
   * Recommended: 0.05-0.15 (5-15%)
   */
  canaryPercentage: number;

  /**
   * Random seed for deterministic canary selection
   * (optional, for testing/reproducibility)
   */
  seed?: number;
}

/**
 * Default canary configuration
 */
export const DEFAULT_CANARY_CONFIG: CanaryConfig = {
  canaryPercentage: 0.10, // 10% of blocks are canaries
};

/**
 * Simple seedable pseudo-random number generator
 * Uses Linear Congruential Generator (LCG) algorithm
 *
 * @param seed Random seed
 * @returns Random number between 0 and 1
 */
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/**
 * Determine if a block should be a canary based on configuration
 *
 * This uses deterministic randomness so the system can verify
 * which blocks were canaries after the fact.
 *
 * @param blockId Unique identifier for the block
 * @param config Canary configuration
 * @returns true if this block should be a canary
 */
export function shouldBeCanary(blockId: string, config: CanaryConfig): boolean {
  if (config.canaryPercentage <= 0) {
    return false;
  }

  if (config.canaryPercentage >= 1) {
    return true;
  }

  // Hash the blockId to a number for deterministic randomness
  let hash = 0;
  for (let i = 0; i < blockId.length; i++) {
    hash = ((hash << 5) - hash) + blockId.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Mix with seed if provided
  if (config.seed !== undefined) {
    hash = hash ^ config.seed;
  }

  // Use the hash as a seed for random number generation
  const rng = seededRandom(Math.abs(hash));
  const randomValue = rng();

  return randomValue < config.canaryPercentage;
}

/**
 * Create a canary block template
 *
 * In production, this would be populated with known-answer data.
 * Contributors must return the correct answer to pass the canary check.
 *
 * @param blockId Unique block identifier
 * @param blockType Type of AI block
 * @returns A partial block template marked as canary
 */
export function createCanaryBlockTemplate(
  blockId: string,
  blockType: BlockType
): Pick<CompletedBlock, 'isCanary' | 'blockType'> & { blockId: string } {
  return {
    blockId,
    blockType,
    isCanary: true,
  };
}

/**
 * Example: Distribute canary blocks across a batch of block IDs
 *
 * @param blockIds Array of block IDs to potentially mark as canaries
 * @param config Canary configuration
 * @returns Array of block IDs that should be canaries
 */
export function selectCanaryBlocks(
  blockIds: string[],
  config: CanaryConfig = DEFAULT_CANARY_CONFIG
): string[] {
  return blockIds.filter(blockId => shouldBeCanary(blockId, config));
}

/**
 * Validate that canary distribution is within expected range
 * (useful for testing canary percentage configuration)
 *
 * @param totalBlocks Total number of blocks
 * @param canaryCount Number of canary blocks
 * @param expectedPercentage Expected canary percentage
 * @param tolerance Acceptable deviation (e.g., 0.05 = ±5%)
 * @returns true if distribution is within tolerance
 */
export function isCanaryDistributionValid(
  totalBlocks: number,
  canaryCount: number,
  expectedPercentage: number,
  tolerance: number = 0.05
): boolean {
  if (totalBlocks === 0) {
    return canaryCount === 0;
  }

  const actualPercentage = canaryCount / totalBlocks;
  const lowerBound = expectedPercentage - tolerance;
  const upperBound = expectedPercentage + tolerance;

  return actualPercentage >= lowerBound && actualPercentage <= upperBound;
}
