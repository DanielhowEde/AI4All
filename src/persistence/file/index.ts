import * as path from 'path';

export { FileEventStore } from './FileEventStore';
export { FileStateStore } from './FileStateStore';
export { FileAssignmentStore } from './FileAssignmentStore';
export { FileSubmissionStore } from './FileSubmissionStore';
export { FileOperationalStore } from './FileOperationalStore';
export { EventDerivedBalanceLedger } from './EventDerivedBalanceLedger';

import { FileEventStore } from './FileEventStore';
import { FileStateStore } from './FileStateStore';
import { FileAssignmentStore } from './FileAssignmentStore';
import { FileSubmissionStore } from './FileSubmissionStore';
import { FileOperationalStore } from './FileOperationalStore';
import { EventDerivedBalanceLedger } from './EventDerivedBalanceLedger';

export interface FileStores {
  event: FileEventStore;
  state: FileStateStore;
  assignment: FileAssignmentStore;
  submission: FileSubmissionStore;
  operational: FileOperationalStore;
  balance: EventDerivedBalanceLedger;
}

export async function createFileStores(dataDir?: string): Promise<FileStores> {
  const dir = dataDir ?? path.join(process.cwd(), 'data');
  const event = new FileEventStore(dir);
  const state = new FileStateStore(dir);
  const assignment = new FileAssignmentStore(dir);
  const submission = new FileSubmissionStore(dir);
  const operational = new FileOperationalStore(dir);
  const balance = new EventDerivedBalanceLedger(event);

  // Rebuild balance cache from events
  await balance.rebuild();

  return { event, state, assignment, submission, operational, balance };
}
