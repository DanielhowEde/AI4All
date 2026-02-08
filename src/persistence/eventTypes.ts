export interface DomainEvent {
  eventId: string;
  dayId: string;
  sequenceNumber: number;
  timestamp: string; // ISO string, excluded from hash
  eventType: DomainEventType;
  actorId?: string;
  payload: Record<string, unknown>;
  prevEventHash: string;
  eventHash: string;
}

export type DomainEventType =
  | 'NODE_REGISTERED'
  | 'WORK_ASSIGNED'
  | 'CANARIES_SELECTED'
  | 'SUBMISSION_RECEIVED'
  | 'SUBMISSION_PROCESSED'
  | 'CANARY_PASSED'
  | 'CANARY_FAILED'
  | 'DAY_FINALIZED'
  | 'REWARDS_COMMITTED'
  | 'DEVICE_PAIRED'
  | 'DEVICE_UNPAIRED';

export const GENESIS_HASH = 'GENESIS';
