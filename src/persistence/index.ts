// Canonical serialization
export { canonicalStringify, computeHash } from './canonicalSerialize';

// Event types
export {
  DomainEvent,
  DomainEventType,
  GENESIS_HASH,
} from './eventTypes';

// Storage interfaces
export {
  IEventStore,
  IStateStore,
  IAssignmentStore,
  ISubmissionStore,
  StateSnapshot,
} from './interfaces';

// Event builder
export {
  buildDayEvents,
  computeEventHash,
  computeStateHash,
  computeRewardHash,
} from './eventBuilder';

// State projection
export { applyEvent, projectState } from './stateProjection';

// In-memory stores
export {
  InMemoryEventStore,
  InMemoryStateStore,
  InMemoryAssignmentStore,
  InMemorySubmissionStore,
  createInMemoryStores,
} from './inMemoryStores';

// Persist day
export { persistDay } from './persistDay';

// Replay runner
export {
  verifyHashChain,
  replayDay,
  replayDayRange,
  ReplayResult,
  ReplayReport,
} from './replayRunner';
