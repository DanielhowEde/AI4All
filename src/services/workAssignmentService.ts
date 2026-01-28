import { Contributor, BlockAssignment, BlockAssignmentConfig } from '../types';
import { distributeDailyBlocks } from '../blockAssignment';
import { selectCanaryBlocks, CanaryConfig } from '../canaryGenerator';
import { AuditEntry } from './serviceTypes';

/**
 * Assign daily blocks to contributors and inject canary blocks.
 *
 * Pure function: wraps distributeDailyBlocks + selectCanaryBlocks.
 * Returns assignments, the set of canary block IDs, and audit entries.
 */
export function assignDailyWork(
  contributors: Contributor[],
  blockConfig: BlockAssignmentConfig,
  canaryConfig: CanaryConfig,
  currentTime?: Date,
  random?: () => number
): {
  assignments: BlockAssignment[];
  canaryBlockIds: Set<string>;
  audit: AuditEntry[];
} {
  const timestamp = currentTime ?? new Date();
  const audit: AuditEntry[] = [];

  // 1. Distribute blocks via weighted lottery
  const assignments = distributeDailyBlocks(
    contributors,
    blockConfig,
    currentTime,
    random
  );

  // 2. Collect all assigned block IDs
  const allBlockIds = assignments.flatMap(a => a.blockIds);

  // 3. Select which blocks are canaries
  const canaryIds = selectCanaryBlocks(allBlockIds, canaryConfig);
  const canaryBlockIds = new Set(canaryIds);

  // 4. Audit entries
  audit.push({
    timestamp,
    eventType: 'BLOCKS_ASSIGNED',
    details: {
      totalAssignments: assignments.length,
      totalBlocks: allBlockIds.length,
      contributorCount: contributors.length,
    },
  });

  audit.push({
    timestamp,
    eventType: 'CANARIES_INJECTED',
    details: {
      canaryCount: canaryBlockIds.size,
      totalBlocks: allBlockIds.length,
      canaryPercentage:
        allBlockIds.length > 0
          ? canaryBlockIds.size / allBlockIds.length
          : 0,
    },
  });

  return { assignments, canaryBlockIds, audit };
}

/**
 * Get all block IDs assigned to a specific contributor.
 */
export function getAssignedBlockIds(
  assignments: BlockAssignment[],
  contributorId: string
): string[] {
  return assignments
    .filter(a => a.contributorId === contributorId)
    .flatMap(a => a.blockIds);
}
