/**
 * Governance hierarchy types for the persona-based enterprise programme framework.
 *
 * Hierarchy:
 *   Programme Director (Human)
 *     → Master BA        (programme level)
 *       → Project BA     (project level)
 *         → Coder        (delivery level)
 *         → Tester       (delivery level)
 */

// ---------------------------------------------------------------------------
// Persona
// ---------------------------------------------------------------------------

export type PersonaType = 'master-ba' | 'project-ba' | 'coder' | 'tester';
export type GovernanceLevel = 'programme' | 'project' | 'delivery';

export interface RegisteredPersona {
  personaId: string;
  personaType: PersonaType;
  deviceId: string;         // linked worker device
  accountId: string;        // wallet address
  registeredAt: string;     // ISO-8601
  walletBlockHash?: string; // wallet chain block that recorded registration
}

// ---------------------------------------------------------------------------
// Programme
// ---------------------------------------------------------------------------

export type ProgrammeStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface Programme {
  programmeId: string;
  name: string;
  description: string;
  masterBaPersonaId: string;
  createdAt: string;
  status: ProgrammeStatus;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface Project {
  projectId: string;
  programmeId: string;
  name: string;
  description: string;
  projectBaPersonaId: string;
  acceptanceCriteria: string[];
  createdAt: string;
  status: ProjectStatus;
}

// ---------------------------------------------------------------------------
// Milestone
// ---------------------------------------------------------------------------

export type MilestoneState =
  | 'DEFINED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'TESTING'
  | 'TEST_PASSED'
  | 'TEST_FAILED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'COMPLETED';

/** Valid state transitions enforced server-side. */
export const VALID_MILESTONE_TRANSITIONS: Record<MilestoneState, MilestoneState[]> = {
  DEFINED: ['ASSIGNED'],
  ASSIGNED: ['IN_PROGRESS'],
  IN_PROGRESS: ['SUBMITTED'],
  SUBMITTED: ['TESTING'],
  TESTING: ['TEST_PASSED', 'TEST_FAILED'],
  TEST_PASSED: ['ACCEPTED', 'REJECTED'],
  TEST_FAILED: ['IN_PROGRESS'],
  ACCEPTED: ['COMPLETED'],
  REJECTED: ['IN_PROGRESS'],
  COMPLETED: [],
};

export interface Milestone {
  milestoneId: string;
  projectId: string;
  name: string;
  description: string;
  acceptanceCriteria: string[];
  assignedCoderPersonaId?: string;
  assignedTesterPersonaId?: string;
  state: MilestoneState;
  tokenReward: string;       // microunits as string (bigint safe)
  deliverableHash?: string;  // SHA-256 of submitted deliverable
  testReportHash?: string;   // SHA-256 of test report
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneHistoryEntry {
  milestoneId: string;
  fromState: MilestoneState;
  toState: MilestoneState;
  personaId: string;
  timestamp: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Inter-persona messaging
// ---------------------------------------------------------------------------

export interface PersonaMessage {
  messageId: string;
  fromPersonaId: string;
  toPersonaId: string;
  subject: string;
  content: string;
  milestoneId?: string;      // optional reference
  createdAt: string;
  read: boolean;
}

// ---------------------------------------------------------------------------
// Communication rules
// ---------------------------------------------------------------------------

/** Which persona types can message which. */
export const COMMUNICATION_MATRIX: Record<PersonaType, PersonaType[]> = {
  'master-ba': ['project-ba'],
  'project-ba': ['master-ba', 'coder', 'tester'],
  'coder': ['project-ba', 'tester'],
  'tester': ['project-ba', 'coder'],
};

/** Escalation targets for each persona type. */
export const ESCALATION_TARGET: Partial<Record<PersonaType, PersonaType>> = {
  'project-ba': 'master-ba',
  'coder': 'project-ba',
  'tester': 'project-ba',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function governanceLevelFor(pt: PersonaType): GovernanceLevel {
  switch (pt) {
    case 'master-ba': return 'programme';
    case 'project-ba': return 'project';
    case 'coder':
    case 'tester': return 'delivery';
  }
}

export function isValidTransition(from: MilestoneState, to: MilestoneState): boolean {
  return VALID_MILESTONE_TRANSITIONS[from].includes(to);
}
