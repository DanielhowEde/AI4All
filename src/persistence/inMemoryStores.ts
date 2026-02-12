import { DomainEvent, DomainEventType } from './eventTypes';
import {
  IEventStore,
  IStateStore,
  IAssignmentStore,
  ISubmissionStore,
  StateSnapshot,
} from './interfaces';
import { NetworkState, BlockSubmission } from '../services/serviceTypes';
import { BlockAssignment } from '../types';

export class InMemoryEventStore implements IEventStore {
  private events: DomainEvent[] = [];

  async append(events: DomainEvent[]): Promise<void> {
    this.events.push(...events);
  }

  async queryByDay(dayId: string): Promise<DomainEvent[]> {
    return this.events.filter(e => e.dayId === dayId);
  }

  async queryByActor(
    actorId: string,
    dayRange?: { from: string; to: string }
  ): Promise<DomainEvent[]> {
    return this.events.filter(e => {
      if (e.actorId !== actorId) return false;
      if (dayRange) {
        if (e.dayId < dayRange.from || e.dayId > dayRange.to) return false;
      }
      return true;
    });
  }

  async queryByType(
    eventType: DomainEventType,
    dayRange?: { from: string; to: string }
  ): Promise<DomainEvent[]> {
    return this.events.filter(e => {
      if (e.eventType !== eventType) return false;
      if (dayRange) {
        if (e.dayId < dayRange.from || e.dayId > dayRange.to) return false;
      }
      return true;
    });
  }

  async getLastEvent(): Promise<DomainEvent | undefined> {
    return this.events.length > 0 ? this.events[this.events.length - 1] : undefined;
  }

  async getLastEventForDay(dayId: string): Promise<DomainEvent | undefined> {
    const dayEvents = await this.queryByDay(dayId);
    return dayEvents.length > 0 ? dayEvents[dayEvents.length - 1] : undefined;
  }

  getAllEvents(): DomainEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

export class InMemoryStateStore implements IStateStore {
  private snapshots = new Map<string, StateSnapshot>();
  private states = new Map<string, NetworkState>();

  async saveSnapshot(snapshot: StateSnapshot): Promise<void> {
    this.snapshots.set(snapshot.dayId, snapshot);
  }

  async loadSnapshot(dayId: string): Promise<StateSnapshot | undefined> {
    return this.snapshots.get(dayId);
  }

  async loadLatestSnapshot(): Promise<StateSnapshot | undefined> {
    if (this.snapshots.size === 0) return undefined;
    const sorted = [...this.snapshots.values()].sort((a, b) =>
      b.dayId.localeCompare(a.dayId)
    );
    return sorted[0];
  }

  async saveState(dayId: string, state: NetworkState): Promise<void> {
    this.states.set(dayId, state);
  }

  async loadState(dayId: string): Promise<NetworkState | undefined> {
    return this.states.get(dayId);
  }

  clear(): void {
    this.snapshots.clear();
    this.states.clear();
  }
}

export class InMemoryAssignmentStore implements IAssignmentStore {
  private assignments = new Map<string, BlockAssignment[]>();

  async putAssignments(dayId: string, assignments: BlockAssignment[]): Promise<void> {
    this.assignments.set(dayId, assignments);
  }

  async getByNode(dayId: string, nodeId: string): Promise<BlockAssignment[]> {
    const dayAssignments = this.assignments.get(dayId) ?? [];
    return dayAssignments.filter(a => a.contributorId === nodeId);
  }

  async getByDay(dayId: string): Promise<BlockAssignment[]> {
    return this.assignments.get(dayId) ?? [];
  }

  clear(): void {
    this.assignments.clear();
  }
}

export class InMemorySubmissionStore implements ISubmissionStore {
  private submissions = new Map<string, BlockSubmission[]>();

  async putSubmissions(dayId: string, submissions: BlockSubmission[]): Promise<void> {
    this.submissions.set(dayId, submissions);
  }

  async appendSubmission(dayId: string, submission: BlockSubmission): Promise<void> {
    const existing = this.submissions.get(dayId) ?? [];
    existing.push(submission);
    this.submissions.set(dayId, existing);
  }

  async listByDay(dayId: string): Promise<BlockSubmission[]> {
    return this.submissions.get(dayId) ?? [];
  }

  async listByNode(dayId: string, nodeId: string): Promise<BlockSubmission[]> {
    const daySubmissions = this.submissions.get(dayId) ?? [];
    return daySubmissions.filter(s => s.contributorId === nodeId);
  }

  clear(): void {
    this.submissions.clear();
  }
}

export function createInMemoryStores(): {
  event: InMemoryEventStore;
  state: InMemoryStateStore;
  assignment: InMemoryAssignmentStore;
  submission: InMemorySubmissionStore;
} {
  return {
    event: new InMemoryEventStore(),
    state: new InMemoryStateStore(),
    assignment: new InMemoryAssignmentStore(),
    submission: new InMemorySubmissionStore(),
  };
}
