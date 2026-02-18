import * as fs from 'fs';
import * as path from 'path';
import { IStateStore, StateSnapshot } from '../interfaces';
import { NetworkState } from '../../services/serviceTypes';
import { serializeNetworkState, deserializeNetworkState } from '../stateSerializer';

interface SnapshotFile {
  snapshot: StateSnapshot;
  stateJson: string;
}

export class FileStateStore implements IStateStore {
  private snapshotsDir: string;

  constructor(dataDir: string) {
    this.snapshotsDir = path.join(dataDir, 'snapshots');
    fs.mkdirSync(this.snapshotsDir, { recursive: true });
  }

  private filePath(dayId: string): string {
    return path.join(this.snapshotsDir, `${dayId}.json`);
  }

  private readFile(dayId: string): SnapshotFile | undefined {
    const fp = this.filePath(dayId);
    if (!fs.existsSync(fp)) return undefined;
    return JSON.parse(fs.readFileSync(fp, 'utf-8')) as SnapshotFile;
  }

  private writeFile(dayId: string, data: SnapshotFile): void {
    const fp = this.filePath(dayId);
    const tmp = fp + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, fp);
  }

  async saveSnapshot(snapshot: StateSnapshot): Promise<void> {
    const existing = this.readFile(snapshot.dayId);
    this.writeFile(snapshot.dayId, {
      snapshot,
      stateJson: existing?.stateJson ?? '',
    });
  }

  async loadSnapshot(dayId: string): Promise<StateSnapshot | undefined> {
    return this.readFile(dayId)?.snapshot;
  }

  async loadLatestSnapshot(): Promise<StateSnapshot | undefined> {
    if (!fs.existsSync(this.snapshotsDir)) return undefined;
    const files = fs.readdirSync(this.snapshotsDir)
      .filter(f => f.endsWith('.json'))
      .sort();
    if (files.length === 0) return undefined;
    const latest = files[files.length - 1].replace('.json', '');
    return this.readFile(latest)?.snapshot;
  }

  async saveState(dayId: string, state: NetworkState): Promise<void> {
    const existing = this.readFile(dayId);
    this.writeFile(dayId, {
      snapshot: existing?.snapshot ?? ({} as StateSnapshot),
      stateJson: serializeNetworkState(state),
    });
  }

  async loadState(dayId: string): Promise<NetworkState | undefined> {
    const file = this.readFile(dayId);
    if (!file || !file.stateJson) return undefined;
    return deserializeNetworkState(file.stateJson);
  }
}
