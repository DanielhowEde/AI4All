import type Database from 'better-sqlite3';
import { ISubmissionStore } from '../interfaces';
import { BlockSubmission } from '../../services/serviceTypes';
import { deserializeSubmission } from './stateSerializer';

export class SqliteSubmissionStore implements ISubmissionStore {
  private stmtInsert;
  private stmtByDay;
  private stmtByNode;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO submissions (day_id, contributor_id, block_id, block_type, resource_usage, difficulty_multiplier, validation_passed, canary_answer_correct, timestamp)
      VALUES (@dayId, @contributorId, @blockId, @blockType, @resourceUsage, @difficultyMultiplier, @validationPassed, @canaryAnswerCorrect, @timestamp)
    `);
    this.stmtByDay = db.prepare(
      'SELECT * FROM submissions WHERE day_id = ?'
    );
    this.stmtByNode = db.prepare(
      'SELECT * FROM submissions WHERE day_id = ? AND contributor_id = ?'
    );
  }

  async putSubmissions(dayId: string, submissions: BlockSubmission[]): Promise<void> {
    const insertMany = this.db.transaction((items: BlockSubmission[]) => {
      for (const s of items) {
        this.insertOne(dayId, s);
      }
    });
    insertMany(submissions);
  }

  async appendSubmission(dayId: string, submission: BlockSubmission): Promise<void> {
    this.insertOne(dayId, submission);
  }

  async listByDay(dayId: string): Promise<BlockSubmission[]> {
    const rows = this.stmtByDay.all(dayId) as Record<string, unknown>[];
    return rows.map(deserializeSubmission);
  }

  async listByNode(dayId: string, nodeId: string): Promise<BlockSubmission[]> {
    const rows = this.stmtByNode.all(dayId, nodeId) as Record<string, unknown>[];
    return rows.map(deserializeSubmission);
  }

  private insertOne(dayId: string, s: BlockSubmission): void {
    this.stmtInsert.run({
      dayId,
      contributorId: s.contributorId,
      blockId: s.blockId,
      blockType: s.blockType,
      resourceUsage: s.resourceUsage,
      difficultyMultiplier: s.difficultyMultiplier,
      validationPassed: s.validationPassed ? 1 : 0,
      canaryAnswerCorrect: s.canaryAnswerCorrect != null ? (s.canaryAnswerCorrect ? 1 : 0) : null,
      timestamp: s.timestamp instanceof Date ? s.timestamp.toISOString() : String(s.timestamp),
    });
  }
}
