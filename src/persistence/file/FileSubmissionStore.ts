import * as fs from 'fs';
import * as path from 'path';
import { ISubmissionStore } from '../interfaces';
import { BlockSubmission } from '../../services/serviceTypes';
import { BlockType } from '../../types';

interface SerializedSubmission {
  contributorId: string;
  blockId: string;
  blockType: string;
  resourceUsage: number;
  difficultyMultiplier: number;
  validationPassed: boolean;
  canaryAnswerCorrect?: boolean;
  timestamp: string;
}

export class FileSubmissionStore implements ISubmissionStore {
  private submissionsDir: string;

  constructor(dataDir: string) {
    this.submissionsDir = path.join(dataDir, 'submissions');
    fs.mkdirSync(this.submissionsDir, { recursive: true });
  }

  private filePath(dayId: string): string {
    return path.join(this.submissionsDir, `${dayId}.json`);
  }

  private readDay(dayId: string): BlockSubmission[] {
    const fp = this.filePath(dayId);
    if (!fs.existsSync(fp)) return [];
    const items = JSON.parse(fs.readFileSync(fp, 'utf-8')) as SerializedSubmission[];
    return items.map(s => ({
      contributorId: s.contributorId,
      blockId: s.blockId,
      blockType: s.blockType as BlockType,
      resourceUsage: s.resourceUsage,
      difficultyMultiplier: s.difficultyMultiplier,
      validationPassed: s.validationPassed,
      canaryAnswerCorrect: s.canaryAnswerCorrect,
      timestamp: new Date(s.timestamp),
    }));
  }

  private serializeSubmissions(submissions: BlockSubmission[]): SerializedSubmission[] {
    return submissions.map(s => ({
      contributorId: s.contributorId,
      blockId: s.blockId,
      blockType: s.blockType,
      resourceUsage: s.resourceUsage,
      difficultyMultiplier: s.difficultyMultiplier,
      validationPassed: s.validationPassed,
      canaryAnswerCorrect: s.canaryAnswerCorrect,
      timestamp: s.timestamp instanceof Date ? s.timestamp.toISOString() : String(s.timestamp),
    }));
  }

  private writeDay(dayId: string, submissions: BlockSubmission[]): void {
    const fp = this.filePath(dayId);
    const tmp = fp + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.serializeSubmissions(submissions), null, 2), 'utf-8');
    fs.renameSync(tmp, fp);
  }

  async putSubmissions(dayId: string, submissions: BlockSubmission[]): Promise<void> {
    this.writeDay(dayId, submissions);
  }

  async appendSubmission(dayId: string, submission: BlockSubmission): Promise<void> {
    const existing = this.readDay(dayId);
    existing.push(submission);
    this.writeDay(dayId, existing);
  }

  async listByDay(dayId: string): Promise<BlockSubmission[]> {
    return this.readDay(dayId);
  }

  async listByNode(dayId: string, nodeId: string): Promise<BlockSubmission[]> {
    return this.readDay(dayId).filter(s => s.contributorId === nodeId);
  }
}
