import type Database from 'better-sqlite3';
import { IAssignmentStore } from '../interfaces';
import { BlockAssignment } from '../../types';

export class SqliteAssignmentStore implements IAssignmentStore {
  private stmtInsert;
  private stmtByDay;
  private stmtByNode;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO assignments (day_id, contributor_id, block_ids, assigned_at, batch_number)
      VALUES (@dayId, @contributorId, @blockIds, @assignedAt, @batchNumber)
    `);
    this.stmtByDay = db.prepare(
      'SELECT * FROM assignments WHERE day_id = ?'
    );
    this.stmtByNode = db.prepare(
      'SELECT * FROM assignments WHERE day_id = ? AND contributor_id = ?'
    );
  }

  async putAssignments(dayId: string, assignments: BlockAssignment[]): Promise<void> {
    const insertMany = this.db.transaction((items: BlockAssignment[]) => {
      for (const a of items) {
        this.stmtInsert.run({
          dayId,
          contributorId: a.contributorId,
          blockIds: JSON.stringify(a.blockIds),
          assignedAt: a.assignedAt instanceof Date ? a.assignedAt.toISOString() : String(a.assignedAt),
          batchNumber: a.batchNumber,
        });
      }
    });
    insertMany(assignments);
  }

  async getByNode(dayId: string, nodeId: string): Promise<BlockAssignment[]> {
    const rows = this.stmtByNode.all(dayId, nodeId) as AssignmentRow[];
    return rows.map(rowToAssignment);
  }

  async getByDay(dayId: string): Promise<BlockAssignment[]> {
    const rows = this.stmtByDay.all(dayId) as AssignmentRow[];
    return rows.map(rowToAssignment);
  }
}

interface AssignmentRow {
  id: number;
  day_id: string;
  contributor_id: string;
  block_ids: string;
  assigned_at: string;
  batch_number: number;
}

function rowToAssignment(row: AssignmentRow): BlockAssignment {
  return {
    contributorId: row.contributor_id,
    blockIds: JSON.parse(row.block_ids),
    assignedAt: new Date(row.assigned_at),
    batchNumber: row.batch_number,
  };
}
