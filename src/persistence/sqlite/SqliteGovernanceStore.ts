/**
 * SQLite store for governance data: personas, programmes, projects,
 * milestones, milestone history, and inter-persona messages.
 *
 * Follows the SqliteChainStore pattern with prepared statements.
 */

import type Database from 'better-sqlite3';
import type {
  RegisteredPersona,
  Programme,
  Project,
  Milestone,
  MilestoneState,
  MilestoneHistoryEntry,
  PersonaMessage,
} from '../../governance/types';

export class SqliteGovernanceStore {
  // Persona statements
  private stmtInsertPersona: Database.Statement;
  private stmtGetPersona: Database.Statement;
  private stmtListPersonas: Database.Statement;

  // Programme statements
  private stmtInsertProgramme: Database.Statement;
  private stmtGetProgramme: Database.Statement;
  private stmtListProgrammes: Database.Statement;

  // Project statements
  private stmtInsertProject: Database.Statement;
  private stmtGetProject: Database.Statement;
  private stmtListProjectsByProgramme: Database.Statement;

  // Milestone statements
  private stmtInsertMilestone: Database.Statement;
  private stmtGetMilestone: Database.Statement;
  private stmtListMilestonesByProject: Database.Statement;
  private stmtUpdateMilestoneState: Database.Statement;
  private stmtAssignMilestone: Database.Statement;
  private stmtSetDeliverableHash: Database.Statement;
  private stmtSetTestReportHash: Database.Statement;

  // Milestone history statements
  private stmtInsertHistory: Database.Statement;
  private stmtGetHistory: Database.Statement;

  // Message statements
  private stmtInsertMessage: Database.Statement;
  private stmtGetMessagesFor: Database.Statement;
  private stmtGetUnreadFor: Database.Statement;
  private stmtMarkRead: Database.Statement;

  constructor(db: Database.Database) {
    // -- Personas --
    this.stmtInsertPersona = db.prepare(
      `INSERT INTO personas (persona_id, persona_type, device_id, account_id, registered_at, wallet_block_hash)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    this.stmtGetPersona = db.prepare(`SELECT * FROM personas WHERE persona_id = ?`);
    this.stmtListPersonas = db.prepare(`SELECT * FROM personas ORDER BY registered_at ASC`);

    // -- Programmes --
    this.stmtInsertProgramme = db.prepare(
      `INSERT INTO programmes (programme_id, name, description, master_ba_persona_id, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    this.stmtGetProgramme = db.prepare(`SELECT * FROM programmes WHERE programme_id = ?`);
    this.stmtListProgrammes = db.prepare(`SELECT * FROM programmes ORDER BY created_at ASC`);

    // -- Projects --
    this.stmtInsertProject = db.prepare(
      `INSERT INTO projects (project_id, programme_id, name, description, project_ba_persona_id, acceptance_criteria_json, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.stmtGetProject = db.prepare(`SELECT * FROM projects WHERE project_id = ?`);
    this.stmtListProjectsByProgramme = db.prepare(`SELECT * FROM projects WHERE programme_id = ? ORDER BY created_at ASC`);

    // -- Milestones --
    this.stmtInsertMilestone = db.prepare(
      `INSERT INTO milestones (milestone_id, project_id, name, description, acceptance_criteria_json, state, token_reward, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.stmtGetMilestone = db.prepare(`SELECT * FROM milestones WHERE milestone_id = ?`);
    this.stmtListMilestonesByProject = db.prepare(`SELECT * FROM milestones WHERE project_id = ? ORDER BY created_at ASC`);
    this.stmtUpdateMilestoneState = db.prepare(
      `UPDATE milestones SET state = ?, updated_at = ? WHERE milestone_id = ?`
    );
    this.stmtAssignMilestone = db.prepare(
      `UPDATE milestones SET assigned_coder_persona_id = ?, assigned_tester_persona_id = ?, state = 'ASSIGNED', updated_at = ? WHERE milestone_id = ?`
    );
    this.stmtSetDeliverableHash = db.prepare(
      `UPDATE milestones SET deliverable_hash = ?, updated_at = ? WHERE milestone_id = ?`
    );
    this.stmtSetTestReportHash = db.prepare(
      `UPDATE milestones SET test_report_hash = ?, updated_at = ? WHERE milestone_id = ?`
    );

    // -- Milestone History --
    this.stmtInsertHistory = db.prepare(
      `INSERT INTO milestone_history (milestone_id, from_state, to_state, persona_id, timestamp, reason)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    this.stmtGetHistory = db.prepare(
      `SELECT * FROM milestone_history WHERE milestone_id = ? ORDER BY timestamp ASC`
    );

    // -- Messages --
    this.stmtInsertMessage = db.prepare(
      `INSERT INTO persona_messages (message_id, from_persona_id, to_persona_id, subject, content, milestone_id, created_at, read)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    );
    this.stmtGetMessagesFor = db.prepare(
      `SELECT * FROM persona_messages WHERE to_persona_id = ? ORDER BY created_at DESC`
    );
    this.stmtGetUnreadFor = db.prepare(
      `SELECT * FROM persona_messages WHERE to_persona_id = ? AND read = 0 ORDER BY created_at ASC`
    );
    this.stmtMarkRead = db.prepare(`UPDATE persona_messages SET read = 1 WHERE message_id = ?`);
  }

  // =========================================================================
  // Personas
  // =========================================================================

  insertPersona(p: RegisteredPersona): void {
    this.stmtInsertPersona.run(
      p.personaId, p.personaType, p.deviceId, p.accountId,
      p.registeredAt, p.walletBlockHash ?? null,
    );
  }

  getPersona(personaId: string): RegisteredPersona | null {
    const row = this.stmtGetPersona.get(personaId) as PersonaRow | undefined;
    return row ? toRegisteredPersona(row) : null;
  }

  listPersonas(): RegisteredPersona[] {
    return (this.stmtListPersonas.all() as PersonaRow[]).map(toRegisteredPersona);
  }

  // =========================================================================
  // Programmes
  // =========================================================================

  insertProgramme(p: Programme): void {
    this.stmtInsertProgramme.run(p.programmeId, p.name, p.description, p.masterBaPersonaId, p.createdAt, p.status);
  }

  getProgramme(programmeId: string): Programme | null {
    const row = this.stmtGetProgramme.get(programmeId) as ProgrammeRow | undefined;
    return row ? toProgramme(row) : null;
  }

  listProgrammes(): Programme[] {
    return (this.stmtListProgrammes.all() as ProgrammeRow[]).map(toProgramme);
  }

  // =========================================================================
  // Projects
  // =========================================================================

  insertProject(p: Project): void {
    this.stmtInsertProject.run(
      p.projectId, p.programmeId, p.name, p.description,
      p.projectBaPersonaId, JSON.stringify(p.acceptanceCriteria),
      p.createdAt, p.status,
    );
  }

  getProject(projectId: string): Project | null {
    const row = this.stmtGetProject.get(projectId) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }

  listProjectsByProgramme(programmeId: string): Project[] {
    return (this.stmtListProjectsByProgramme.all(programmeId) as ProjectRow[]).map(toProject);
  }

  // =========================================================================
  // Milestones
  // =========================================================================

  insertMilestone(m: Milestone): void {
    this.stmtInsertMilestone.run(
      m.milestoneId, m.projectId, m.name, m.description,
      JSON.stringify(m.acceptanceCriteria), m.state,
      m.tokenReward, m.createdAt, m.updatedAt,
    );
  }

  getMilestone(milestoneId: string): Milestone | null {
    const row = this.stmtGetMilestone.get(milestoneId) as MilestoneRow | undefined;
    return row ? toMilestone(row) : null;
  }

  listMilestonesByProject(projectId: string): Milestone[] {
    return (this.stmtListMilestonesByProject.all(projectId) as MilestoneRow[]).map(toMilestone);
  }

  updateMilestoneState(milestoneId: string, state: MilestoneState, now: string): void {
    this.stmtUpdateMilestoneState.run(state, now, milestoneId);
  }

  assignMilestone(milestoneId: string, coderId: string, testerId: string, now: string): void {
    this.stmtAssignMilestone.run(coderId, testerId, now, milestoneId);
  }

  setDeliverableHash(milestoneId: string, hash: string, now: string): void {
    this.stmtSetDeliverableHash.run(hash, now, milestoneId);
  }

  setTestReportHash(milestoneId: string, hash: string, now: string): void {
    this.stmtSetTestReportHash.run(hash, now, milestoneId);
  }

  // =========================================================================
  // Milestone History
  // =========================================================================

  insertHistoryEntry(entry: MilestoneHistoryEntry): void {
    this.stmtInsertHistory.run(
      entry.milestoneId, entry.fromState, entry.toState,
      entry.personaId, entry.timestamp, entry.reason ?? null,
    );
  }

  getHistory(milestoneId: string): MilestoneHistoryEntry[] {
    return (this.stmtGetHistory.all(milestoneId) as HistoryRow[]).map(toHistoryEntry);
  }

  // =========================================================================
  // Messages
  // =========================================================================

  insertMessage(msg: PersonaMessage): void {
    this.stmtInsertMessage.run(
      msg.messageId, msg.fromPersonaId, msg.toPersonaId,
      msg.subject, msg.content, msg.milestoneId ?? null,
      msg.createdAt,
    );
  }

  getMessagesFor(personaId: string): PersonaMessage[] {
    return (this.stmtGetMessagesFor.all(personaId) as MessageRow[]).map(toPersonaMessage);
  }

  getUnreadFor(personaId: string): PersonaMessage[] {
    return (this.stmtGetUnreadFor.all(personaId) as MessageRow[]).map(toPersonaMessage);
  }

  markRead(messageId: string): void {
    this.stmtMarkRead.run(messageId);
  }
}

// ---------------------------------------------------------------------------
// Row types and mappers
// ---------------------------------------------------------------------------

interface PersonaRow {
  persona_id: string;
  persona_type: string;
  device_id: string;
  account_id: string;
  registered_at: string;
  wallet_block_hash: string | null;
}

function toRegisteredPersona(row: PersonaRow): RegisteredPersona {
  return {
    personaId: row.persona_id,
    personaType: row.persona_type as RegisteredPersona['personaType'],
    deviceId: row.device_id,
    accountId: row.account_id,
    registeredAt: row.registered_at,
    walletBlockHash: row.wallet_block_hash ?? undefined,
  };
}

interface ProgrammeRow {
  programme_id: string;
  name: string;
  description: string;
  master_ba_persona_id: string;
  created_at: string;
  status: string;
}

function toProgramme(row: ProgrammeRow): Programme {
  return {
    programmeId: row.programme_id,
    name: row.name,
    description: row.description,
    masterBaPersonaId: row.master_ba_persona_id,
    createdAt: row.created_at,
    status: row.status as Programme['status'],
  };
}

interface ProjectRow {
  project_id: string;
  programme_id: string;
  name: string;
  description: string;
  project_ba_persona_id: string;
  acceptance_criteria_json: string;
  created_at: string;
  status: string;
}

function toProject(row: ProjectRow): Project {
  return {
    projectId: row.project_id,
    programmeId: row.programme_id,
    name: row.name,
    description: row.description,
    projectBaPersonaId: row.project_ba_persona_id,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria_json),
    createdAt: row.created_at,
    status: row.status as Project['status'],
  };
}

interface MilestoneRow {
  milestone_id: string;
  project_id: string;
  name: string;
  description: string;
  acceptance_criteria_json: string;
  assigned_coder_persona_id: string | null;
  assigned_tester_persona_id: string | null;
  state: string;
  token_reward: string;
  deliverable_hash: string | null;
  test_report_hash: string | null;
  created_at: string;
  updated_at: string;
}

function toMilestone(row: MilestoneRow): Milestone {
  return {
    milestoneId: row.milestone_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria_json),
    assignedCoderPersonaId: row.assigned_coder_persona_id ?? undefined,
    assignedTesterPersonaId: row.assigned_tester_persona_id ?? undefined,
    state: row.state as MilestoneState,
    tokenReward: row.token_reward,
    deliverableHash: row.deliverable_hash ?? undefined,
    testReportHash: row.test_report_hash ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface HistoryRow {
  milestone_id: string;
  from_state: string;
  to_state: string;
  persona_id: string;
  timestamp: string;
  reason: string | null;
}

function toHistoryEntry(row: HistoryRow): MilestoneHistoryEntry {
  return {
    milestoneId: row.milestone_id,
    fromState: row.from_state as MilestoneState,
    toState: row.to_state as MilestoneState,
    personaId: row.persona_id,
    timestamp: row.timestamp,
    reason: row.reason ?? undefined,
  };
}

interface MessageRow {
  message_id: string;
  from_persona_id: string;
  to_persona_id: string;
  subject: string;
  content: string;
  milestone_id: string | null;
  created_at: string;
  read: number;
}

function toPersonaMessage(row: MessageRow): PersonaMessage {
  return {
    messageId: row.message_id,
    fromPersonaId: row.from_persona_id,
    toPersonaId: row.to_persona_id,
    subject: row.subject,
    content: row.content,
    milestoneId: row.milestone_id ?? undefined,
    createdAt: row.created_at,
    read: row.read === 1,
  };
}
