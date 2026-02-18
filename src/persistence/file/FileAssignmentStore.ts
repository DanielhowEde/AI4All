import * as fs from 'fs';
import * as path from 'path';
import { IAssignmentStore } from '../interfaces';
import { BlockAssignment } from '../../types';

interface SerializedAssignment {
  contributorId: string;
  blockIds: string[];
  assignedAt: string;
  batchNumber: number;
}

export class FileAssignmentStore implements IAssignmentStore {
  private assignmentsDir: string;

  constructor(dataDir: string) {
    this.assignmentsDir = path.join(dataDir, 'assignments');
    fs.mkdirSync(this.assignmentsDir, { recursive: true });
  }

  private filePath(dayId: string): string {
    return path.join(this.assignmentsDir, `${dayId}.json`);
  }

  private readDay(dayId: string): BlockAssignment[] {
    const fp = this.filePath(dayId);
    if (!fs.existsSync(fp)) return [];
    const items = JSON.parse(fs.readFileSync(fp, 'utf-8')) as SerializedAssignment[];
    return items.map(a => ({
      contributorId: a.contributorId,
      blockIds: a.blockIds,
      assignedAt: new Date(a.assignedAt),
      batchNumber: a.batchNumber,
    }));
  }

  async putAssignments(dayId: string, assignments: BlockAssignment[]): Promise<void> {
    const serialized: SerializedAssignment[] = assignments.map(a => ({
      contributorId: a.contributorId,
      blockIds: a.blockIds,
      assignedAt: a.assignedAt instanceof Date ? a.assignedAt.toISOString() : String(a.assignedAt),
      batchNumber: a.batchNumber,
    }));
    const fp = this.filePath(dayId);
    const tmp = fp + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(serialized, null, 2), 'utf-8');
    fs.renameSync(tmp, fp);
  }

  async getByNode(dayId: string, nodeId: string): Promise<BlockAssignment[]> {
    return this.readDay(dayId).filter(a => a.contributorId === nodeId);
  }

  async getByDay(dayId: string): Promise<BlockAssignment[]> {
    return this.readDay(dayId);
  }
}
