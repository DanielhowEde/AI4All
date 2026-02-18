import * as fs from 'fs';
import * as path from 'path';
import { DomainEvent, DomainEventType } from '../eventTypes';
import { IEventStore } from '../interfaces';

export class FileEventStore implements IEventStore {
  private eventsDir: string;

  constructor(dataDir: string) {
    this.eventsDir = path.join(dataDir, 'events');
    fs.mkdirSync(this.eventsDir, { recursive: true });
  }

  private dayPath(dayId: string): string {
    return path.join(this.eventsDir, `${dayId}.jsonl`);
  }

  private readDayEvents(dayId: string): DomainEvent[] {
    const filePath = this.dayPath(dayId);
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => {
        try {
          return JSON.parse(line) as DomainEvent;
        } catch {
          // Skip malformed lines (crash recovery)
          return null;
        }
      })
      .filter((e): e is DomainEvent => e !== null);
  }

  private listDayIds(): string[] {
    if (!fs.existsSync(this.eventsDir)) return [];
    return fs.readdirSync(this.eventsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => f.replace('.jsonl', ''))
      .sort();
  }

  async append(events: DomainEvent[]): Promise<void> {
    const byDay = new Map<string, DomainEvent[]>();
    for (const e of events) {
      const arr = byDay.get(e.dayId) ?? [];
      arr.push(e);
      byDay.set(e.dayId, arr);
    }
    for (const [dayId, dayEvents] of byDay) {
      const lines = dayEvents.map(e => JSON.stringify(e)).join('\n') + '\n';
      fs.appendFileSync(this.dayPath(dayId), lines, 'utf-8');
    }
  }

  async queryByDay(dayId: string): Promise<DomainEvent[]> {
    return this.readDayEvents(dayId);
  }

  async queryByActor(
    actorId: string,
    dayRange?: { from: string; to: string }
  ): Promise<DomainEvent[]> {
    const dayIds = this.listDayIds().filter(d =>
      dayRange ? d >= dayRange.from && d <= dayRange.to : true
    );
    const results: DomainEvent[] = [];
    for (const dayId of dayIds) {
      for (const e of this.readDayEvents(dayId)) {
        if (e.actorId === actorId) results.push(e);
      }
    }
    return results;
  }

  async queryByType(
    eventType: DomainEventType,
    dayRange?: { from: string; to: string }
  ): Promise<DomainEvent[]> {
    const dayIds = this.listDayIds().filter(d =>
      dayRange ? d >= dayRange.from && d <= dayRange.to : true
    );
    const results: DomainEvent[] = [];
    for (const dayId of dayIds) {
      for (const e of this.readDayEvents(dayId)) {
        if (e.eventType === eventType) results.push(e);
      }
    }
    return results;
  }

  async getLastEvent(): Promise<DomainEvent | undefined> {
    const dayIds = this.listDayIds();
    if (dayIds.length === 0) return undefined;
    const events = this.readDayEvents(dayIds[dayIds.length - 1]);
    return events.length > 0 ? events[events.length - 1] : undefined;
  }

  async getLastEventForDay(dayId: string): Promise<DomainEvent | undefined> {
    const events = this.readDayEvents(dayId);
    return events.length > 0 ? events[events.length - 1] : undefined;
  }
}
