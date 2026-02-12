/**
 * NetworkState serializer for SQLite storage.
 * Handles Map → entries array, Set → array, Date → ISO string
 * so JSON.stringify round-trips correctly.
 */

import { NetworkState, BlockSubmission, AuditEntry } from '../../services/serviceTypes';
import { Contributor, CompletedBlock } from '../../types';

// ── Serializable shapes ────────────────────────────────────────────

interface SerializedContributor {
  accountId: string;
  completedBlocks: SerializedCompletedBlock[];
  reputationMultiplier: number;
  canaryFailures: number;
  canaryPasses: number;
  lastCanaryFailureTime?: string; // ISO
}

interface SerializedCompletedBlock {
  blockType: string;
  resourceUsage: number;
  difficultyMultiplier: number;
  validationPassed: boolean;
  timestamp: string; // ISO
  isCanary?: boolean;
}

interface SerializedAuditEntry {
  timestamp: string; // ISO
  eventType: string;
  accountId?: string;
  details: Record<string, unknown>;
}

interface SerializedNetworkState {
  contributors: Array<[string, SerializedContributor]>;
  canaryBlockIds: string[];
  auditLog: SerializedAuditEntry[];
  dayNumber: number;
}

// ── Serialize ──────────────────────────────────────────────────────

export function serializeNetworkState(state: NetworkState): string {
  const serialized: SerializedNetworkState = {
    contributors: Array.from(state.contributors.entries()).map(
      ([id, c]) => [id, serializeContributor(c)]
    ),
    canaryBlockIds: Array.from(state.canaryBlockIds),
    auditLog: state.auditLog.map(serializeAuditEntry),
    dayNumber: state.dayNumber,
  };
  return JSON.stringify(serialized);
}

function serializeContributor(c: Contributor): SerializedContributor {
  return {
    accountId: c.accountId,
    completedBlocks: c.completedBlocks.map(b => ({
      blockType: b.blockType,
      resourceUsage: b.resourceUsage,
      difficultyMultiplier: b.difficultyMultiplier,
      validationPassed: b.validationPassed,
      timestamp: b.timestamp instanceof Date ? b.timestamp.toISOString() : String(b.timestamp),
      isCanary: b.isCanary,
    })),
    reputationMultiplier: c.reputationMultiplier,
    canaryFailures: c.canaryFailures,
    canaryPasses: c.canaryPasses,
    lastCanaryFailureTime: c.lastCanaryFailureTime
      ? (c.lastCanaryFailureTime instanceof Date
        ? c.lastCanaryFailureTime.toISOString()
        : String(c.lastCanaryFailureTime))
      : undefined,
  };
}

function serializeAuditEntry(e: AuditEntry): SerializedAuditEntry {
  return {
    timestamp: e.timestamp instanceof Date ? e.timestamp.toISOString() : String(e.timestamp),
    eventType: e.eventType,
    accountId: e.accountId,
    details: e.details,
  };
}

// ── Deserialize ────────────────────────────────────────────────────

export function deserializeNetworkState(json: string): NetworkState {
  const s: SerializedNetworkState = JSON.parse(json);

  const contributors = new Map<string, Contributor>();
  for (const [id, sc] of s.contributors) {
    contributors.set(id, deserializeContributor(sc));
  }

  return {
    contributors,
    canaryBlockIds: new Set(s.canaryBlockIds),
    auditLog: s.auditLog.map(deserializeAuditEntry),
    dayNumber: s.dayNumber,
  };
}

function deserializeContributor(sc: SerializedContributor): Contributor {
  return {
    accountId: sc.accountId,
    completedBlocks: sc.completedBlocks.map(b => ({
      blockType: b.blockType as CompletedBlock['blockType'],
      resourceUsage: b.resourceUsage,
      difficultyMultiplier: b.difficultyMultiplier,
      validationPassed: b.validationPassed,
      timestamp: new Date(b.timestamp),
      isCanary: b.isCanary,
    })),
    reputationMultiplier: sc.reputationMultiplier,
    canaryFailures: sc.canaryFailures,
    canaryPasses: sc.canaryPasses,
    lastCanaryFailureTime: sc.lastCanaryFailureTime
      ? new Date(sc.lastCanaryFailureTime)
      : undefined,
  };
}

function deserializeAuditEntry(se: SerializedAuditEntry): AuditEntry {
  return {
    timestamp: new Date(se.timestamp),
    eventType: se.eventType as AuditEntry['eventType'],
    accountId: se.accountId,
    details: se.details,
  };
}

// ── Submission serializers ─────────────────────────────────────────

export function serializeSubmission(s: BlockSubmission): Record<string, unknown> {
  return {
    contributorId: s.contributorId,
    blockId: s.blockId,
    blockType: s.blockType,
    resourceUsage: s.resourceUsage,
    difficultyMultiplier: s.difficultyMultiplier,
    validationPassed: s.validationPassed,
    canaryAnswerCorrect: s.canaryAnswerCorrect,
    timestamp: s.timestamp instanceof Date ? s.timestamp.toISOString() : String(s.timestamp),
  };
}

export function deserializeSubmission(row: Record<string, unknown>): BlockSubmission {
  return {
    contributorId: row.contributor_id as string,
    blockId: row.block_id as string,
    blockType: row.block_type as BlockSubmission['blockType'],
    resourceUsage: row.resource_usage as number,
    difficultyMultiplier: row.difficulty_multiplier as number,
    validationPassed: (row.validation_passed as number) === 1,
    canaryAnswerCorrect: row.canary_answer_correct != null
      ? (row.canary_answer_correct as number) === 1
      : undefined,
    timestamp: new Date(row.timestamp as string),
  };
}
