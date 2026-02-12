import { DomainEvent, DomainEventType } from './eventTypes';
import { NetworkState, BlockSubmission } from '../services/serviceTypes';
import { BlockAssignment } from '../types';

export interface StateSnapshot {
  dayId: string;
  dayNumber: number;
  stateHash: string;
  lastEventHash: string;
  rewardHash: string;
  contributorCount: number;
  createdAt: string; // ISO string
}

export interface IEventStore {
  append(events: DomainEvent[]): Promise<void>;
  queryByDay(dayId: string): Promise<DomainEvent[]>;
  queryByActor(actorId: string, dayRange?: { from: string; to: string }): Promise<DomainEvent[]>;
  queryByType(eventType: DomainEventType, dayRange?: { from: string; to: string }): Promise<DomainEvent[]>;
  getLastEvent(): Promise<DomainEvent | undefined>;
  getLastEventForDay(dayId: string): Promise<DomainEvent | undefined>;
}

export interface IStateStore {
  saveSnapshot(snapshot: StateSnapshot): Promise<void>;
  loadSnapshot(dayId: string): Promise<StateSnapshot | undefined>;
  loadLatestSnapshot(): Promise<StateSnapshot | undefined>;
  saveState(dayId: string, state: NetworkState): Promise<void>;
  loadState(dayId: string): Promise<NetworkState | undefined>;
}

export interface IAssignmentStore {
  putAssignments(dayId: string, assignments: BlockAssignment[]): Promise<void>;
  getByNode(dayId: string, nodeId: string): Promise<BlockAssignment[]>;
  getByDay(dayId: string): Promise<BlockAssignment[]>;
}

export interface ISubmissionStore {
  putSubmissions(dayId: string, submissions: BlockSubmission[]): Promise<void>;
  appendSubmission?(dayId: string, submission: BlockSubmission): Promise<void>;
  listByDay(dayId: string): Promise<BlockSubmission[]>;
  listByNode(dayId: string, nodeId: string): Promise<BlockSubmission[]>;
}
