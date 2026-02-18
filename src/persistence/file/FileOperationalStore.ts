import * as fs from 'fs';
import * as path from 'path';
import { IOperationalStore, DayLifecycleData } from '../interfaces';

interface OperationalData {
  nodeKeys?: Array<[string, string]>;
  devices?: Array<[string, unknown]>;
  accountDevices?: Array<[string, string[]]>;
  dayLifecycle?: DayLifecycleData;
}

export class FileOperationalStore implements IOperationalStore {
  private filePath: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'operational.json');
  }

  private read(): OperationalData {
    if (!fs.existsSync(this.filePath)) return {};
    return JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as OperationalData;
  }

  private write(data: OperationalData): void {
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }

  saveNodeKeys(nodeKeys: Map<string, string>): void {
    const data = this.read();
    data.nodeKeys = Array.from(nodeKeys.entries());
    this.write(data);
  }

  loadNodeKeys(): Map<string, string> {
    const data = this.read();
    return data.nodeKeys ? new Map(data.nodeKeys) : new Map();
  }

  saveDevices(
    devices: Map<string, unknown>,
    accountDevices: Map<string, string[]>
  ): void {
    const data = this.read();
    data.devices = Array.from(devices.entries());
    data.accountDevices = Array.from(accountDevices.entries());
    this.write(data);
  }

  loadDevices(): {
    devices: Map<string, unknown>;
    accountDevices: Map<string, string[]>;
  } {
    const data = this.read();
    return {
      devices: data.devices ? new Map(data.devices) : new Map(),
      accountDevices: data.accountDevices ? new Map(data.accountDevices) : new Map(),
    };
  }

  saveDayPhase(dayData: DayLifecycleData): void {
    const data = this.read();
    data.dayLifecycle = dayData;
    this.write(data);
  }

  loadDayPhase(): DayLifecycleData | undefined {
    return this.read().dayLifecycle;
  }

  clearDayPhase(): void {
    const data = this.read();
    delete data.dayLifecycle;
    this.write(data);
  }
}
