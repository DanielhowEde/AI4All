import type Database from 'better-sqlite3';
import { DomainEvent, DomainEventType } from '../eventTypes';
import { IEventStore } from '../interfaces';

export class SqliteEventStore implements IEventStore {
  private stmtInsert;
  private stmtByDay;
  private stmtByActor;
  private stmtByActorRange;
  private stmtByType;
  private stmtByTypeRange;
  private stmtLast;
  private stmtLastForDay;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO events (event_id, day_id, sequence_number, timestamp, event_type, actor_id, payload, prev_event_hash, event_hash)
      VALUES (@eventId, @dayId, @sequenceNumber, @timestamp, @eventType, @actorId, @payload, @prevEventHash, @eventHash)
    `);
    this.stmtByDay = db.prepare(
      'SELECT * FROM events WHERE day_id = ? ORDER BY sequence_number ASC'
    );
    this.stmtByActor = db.prepare(
      'SELECT * FROM events WHERE actor_id = ? ORDER BY day_id ASC, sequence_number ASC'
    );
    this.stmtByActorRange = db.prepare(
      'SELECT * FROM events WHERE actor_id = ? AND day_id >= ? AND day_id <= ? ORDER BY day_id ASC, sequence_number ASC'
    );
    this.stmtByType = db.prepare(
      'SELECT * FROM events WHERE event_type = ? ORDER BY day_id ASC, sequence_number ASC'
    );
    this.stmtByTypeRange = db.prepare(
      'SELECT * FROM events WHERE event_type = ? AND day_id >= ? AND day_id <= ? ORDER BY day_id ASC, sequence_number ASC'
    );
    this.stmtLast = db.prepare(
      'SELECT * FROM events ORDER BY rowid DESC LIMIT 1'
    );
    this.stmtLastForDay = db.prepare(
      'SELECT * FROM events WHERE day_id = ? ORDER BY sequence_number DESC LIMIT 1'
    );
  }

  async append(events: DomainEvent[]): Promise<void> {
    const insertMany = this.db.transaction((evts: DomainEvent[]) => {
      for (const e of evts) {
        this.stmtInsert.run({
          eventId: e.eventId,
          dayId: e.dayId,
          sequenceNumber: e.sequenceNumber,
          timestamp: e.timestamp,
          eventType: e.eventType,
          actorId: e.actorId ?? null,
          payload: JSON.stringify(e.payload),
          prevEventHash: e.prevEventHash,
          eventHash: e.eventHash,
        });
      }
    });
    insertMany(events);
  }

  async queryByDay(dayId: string): Promise<DomainEvent[]> {
    const rows = this.stmtByDay.all(dayId) as EventRow[];
    return rows.map(rowToEvent);
  }

  async queryByActor(
    actorId: string,
    dayRange?: { from: string; to: string }
  ): Promise<DomainEvent[]> {
    const rows = dayRange
      ? (this.stmtByActorRange.all(actorId, dayRange.from, dayRange.to) as EventRow[])
      : (this.stmtByActor.all(actorId) as EventRow[]);
    return rows.map(rowToEvent);
  }

  async queryByType(
    eventType: DomainEventType,
    dayRange?: { from: string; to: string }
  ): Promise<DomainEvent[]> {
    const rows = dayRange
      ? (this.stmtByTypeRange.all(eventType, dayRange.from, dayRange.to) as EventRow[])
      : (this.stmtByType.all(eventType) as EventRow[]);
    return rows.map(rowToEvent);
  }

  async getLastEvent(): Promise<DomainEvent | undefined> {
    const row = this.stmtLast.get() as EventRow | undefined;
    return row ? rowToEvent(row) : undefined;
  }

  async getLastEventForDay(dayId: string): Promise<DomainEvent | undefined> {
    const row = this.stmtLastForDay.get(dayId) as EventRow | undefined;
    return row ? rowToEvent(row) : undefined;
  }
}

interface EventRow {
  event_id: string;
  day_id: string;
  sequence_number: number;
  timestamp: string;
  event_type: string;
  actor_id: string | null;
  payload: string;
  prev_event_hash: string;
  event_hash: string;
}

function rowToEvent(row: EventRow): DomainEvent {
  return {
    eventId: row.event_id,
    dayId: row.day_id,
    sequenceNumber: row.sequence_number,
    timestamp: row.timestamp,
    eventType: row.event_type as DomainEventType,
    actorId: row.actor_id ?? undefined,
    payload: JSON.parse(row.payload),
    prevEventHash: row.prev_event_hash,
    eventHash: row.event_hash,
  };
}
