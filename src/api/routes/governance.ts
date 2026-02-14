/**
 * Governance REST endpoints for the persona-based enterprise programme framework.
 *
 * Hierarchy: Programme Director (Human) → Master BA → Project BA → Coder / Tester
 *
 * Follows the existing createXRouter(state) factory pattern.
 */

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { ApiState } from '../state';
import { ErrorCodes } from '../types';
import type {
  RegisteredPersona,
  Programme,
  Project,
  Milestone,
  MilestoneState,
  PersonaMessage,
  PersonaType,
} from '../../governance/types';
import {
  isValidTransition,
  COMMUNICATION_MATRIX,
} from '../../governance/types';

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Create router for governance endpoints.
 */
export function createGovernanceRouter(state: ApiState): Router {
  const router = Router();

  // =========================================================================
  // Personas
  // =========================================================================

  /** POST /governance/personas/register */
  router.post('/personas/register', (req: Request, res: Response) => {
    const { personaType, deviceId, accountId } = req.body;

    if (!personaType || !deviceId || !accountId) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: personaType, deviceId, accountId',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    const validTypes: PersonaType[] = ['master-ba', 'project-ba', 'coder', 'tester'];
    if (!validTypes.includes(personaType)) {
      res.status(400).json({
        success: false,
        error: `Invalid personaType: ${personaType}`,
        code: ErrorCodes.PERSONA_NOT_FOUND,
      });
      return;
    }

    // Check duplicate (same device + type)
    for (const [, p] of state.personas) {
      if (p.deviceId === deviceId && p.personaType === personaType) {
        res.status(409).json({
          success: false,
          error: `Persona ${personaType} already registered for device ${deviceId}`,
          code: ErrorCodes.PERSONA_ALREADY_REGISTERED,
        });
        return;
      }
    }

    const persona: RegisteredPersona = {
      personaId: uuid(),
      personaType,
      deviceId,
      accountId,
      registeredAt: now(),
    };

    state.personas.set(persona.personaId, persona);
    state.governanceStore?.insertPersona(persona);

    res.status(201).json({ success: true, persona });
  });

  /** GET /governance/personas */
  router.get('/personas', (_req: Request, res: Response) => {
    res.json({ success: true, personas: [...state.personas.values()] });
  });

  // =========================================================================
  // Programmes
  // =========================================================================

  /** POST /governance/programmes */
  router.post('/programmes', (req: Request, res: Response) => {
    const { name, description, masterBaPersonaId } = req.body;

    if (!name || !masterBaPersonaId) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: name, masterBaPersonaId',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    // Verify the persona exists and is a master-ba
    const masterBa = state.personas.get(masterBaPersonaId);
    if (!masterBa) {
      res.status(404).json({
        success: false,
        error: 'Master BA persona not found',
        code: ErrorCodes.PERSONA_NOT_FOUND,
      });
      return;
    }
    if (masterBa.personaType !== 'master-ba') {
      res.status(403).json({
        success: false,
        error: 'Only master-ba personas can create programmes',
        code: ErrorCodes.NOT_AUTHORIZED,
      });
      return;
    }

    const programme: Programme = {
      programmeId: uuid(),
      name,
      description: description ?? '',
      masterBaPersonaId,
      createdAt: now(),
      status: 'ACTIVE',
    };

    state.programmes.set(programme.programmeId, programme);
    state.governanceStore?.insertProgramme(programme);

    res.status(201).json({ success: true, programme });
  });

  /** GET /governance/programmes */
  router.get('/programmes', (_req: Request, res: Response) => {
    res.json({ success: true, programmes: [...state.programmes.values()] });
  });

  // =========================================================================
  // Projects
  // =========================================================================

  /** POST /governance/programmes/:programmeId/projects */
  router.post('/programmes/:programmeId/projects', (req: Request, res: Response) => {
    const programmeId = req.params.programmeId as string;
    const { name, description, projectBaPersonaId, acceptanceCriteria } = req.body;

    const programme = state.programmes.get(programmeId);
    if (!programme) {
      res.status(404).json({
        success: false,
        error: 'Programme not found',
        code: ErrorCodes.PROGRAMME_NOT_FOUND,
      });
      return;
    }

    if (!name || !projectBaPersonaId) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: name, projectBaPersonaId',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    // Verify the project-ba persona exists
    const projectBa = state.personas.get(projectBaPersonaId);
    if (!projectBa || projectBa.personaType !== 'project-ba') {
      res.status(400).json({
        success: false,
        error: 'projectBaPersonaId must reference a project-ba persona',
        code: ErrorCodes.PERSONA_NOT_FOUND,
      });
      return;
    }

    const project: Project = {
      projectId: uuid(),
      programmeId,
      name,
      description: description ?? '',
      projectBaPersonaId,
      acceptanceCriteria: acceptanceCriteria ?? [],
      createdAt: now(),
      status: 'PLANNING',
    };

    state.projects.set(project.projectId, project);
    state.governanceStore?.insertProject(project);

    res.status(201).json({ success: true, project });
  });

  /** GET /governance/projects/:projectId */
  router.get('/projects/:projectId', (req: Request, res: Response) => {
    const projectId = req.params.projectId as string;
    const project = state.projects.get(projectId);

    if (!project) {
      res.status(404).json({
        success: false,
        error: 'Project not found',
        code: ErrorCodes.PROJECT_NOT_FOUND,
      });
      return;
    }

    res.json({ success: true, project });
  });

  // =========================================================================
  // Milestones
  // =========================================================================

  /** POST /governance/projects/:projectId/milestones */
  router.post('/projects/:projectId/milestones', (req: Request, res: Response) => {
    const projectId = req.params.projectId as string;
    const { name, description, acceptanceCriteria, tokenReward } = req.body;

    const project = state.projects.get(projectId);
    if (!project) {
      res.status(404).json({
        success: false,
        error: 'Project not found',
        code: ErrorCodes.PROJECT_NOT_FOUND,
      });
      return;
    }

    if (!name) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: name',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    const ts = now();
    const milestone: Milestone = {
      milestoneId: uuid(),
      projectId,
      name,
      description: description ?? '',
      acceptanceCriteria: acceptanceCriteria ?? [],
      state: 'DEFINED',
      tokenReward: tokenReward ?? '0',
      createdAt: ts,
      updatedAt: ts,
    };

    state.milestones.set(milestone.milestoneId, milestone);
    state.governanceStore?.insertMilestone(milestone);

    res.status(201).json({ success: true, milestone });
  });

  /** POST /governance/milestones/:milestoneId/assign */
  router.post('/milestones/:milestoneId/assign', (req: Request, res: Response) => {
    const milestoneId = req.params.milestoneId as string;
    const { coderPersonaId, testerPersonaId } = req.body;

    const milestone = state.milestones.get(milestoneId);
    if (!milestone) {
      res.status(404).json({
        success: false,
        error: 'Milestone not found',
        code: ErrorCodes.MILESTONE_NOT_FOUND,
      });
      return;
    }

    if (milestone.state !== 'DEFINED') {
      res.status(400).json({
        success: false,
        error: `Cannot assign milestone in state ${milestone.state}`,
        code: ErrorCodes.INVALID_TRANSITION,
      });
      return;
    }

    if (!coderPersonaId || !testerPersonaId) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: coderPersonaId, testerPersonaId',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    // Validate persona types
    const coder = state.personas.get(coderPersonaId);
    const tester = state.personas.get(testerPersonaId);
    if (!coder || coder.personaType !== 'coder') {
      res.status(400).json({
        success: false,
        error: 'coderPersonaId must reference a coder persona',
        code: ErrorCodes.PERSONA_NOT_FOUND,
      });
      return;
    }
    if (!tester || tester.personaType !== 'tester') {
      res.status(400).json({
        success: false,
        error: 'testerPersonaId must reference a tester persona',
        code: ErrorCodes.PERSONA_NOT_FOUND,
      });
      return;
    }

    const ts = now();
    milestone.assignedCoderPersonaId = coderPersonaId;
    milestone.assignedTesterPersonaId = testerPersonaId;
    milestone.state = 'ASSIGNED';
    milestone.updatedAt = ts;

    state.governanceStore?.assignMilestone(milestoneId, coderPersonaId, testerPersonaId, ts);
    state.governanceStore?.insertHistoryEntry({
      milestoneId,
      fromState: 'DEFINED',
      toState: 'ASSIGNED',
      personaId: coderPersonaId,
      timestamp: ts,
    });

    res.json({ success: true, milestone });
  });

  /** POST /governance/milestones/:milestoneId/transition */
  router.post('/milestones/:milestoneId/transition', (req: Request, res: Response) => {
    const milestoneId = req.params.milestoneId as string;
    const { toState, personaId, reason } = req.body;

    const milestone = state.milestones.get(milestoneId);
    if (!milestone) {
      res.status(404).json({
        success: false,
        error: 'Milestone not found',
        code: ErrorCodes.MILESTONE_NOT_FOUND,
      });
      return;
    }

    if (!toState || !personaId) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: toState, personaId',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    const persona = state.personas.get(personaId);
    if (!persona) {
      res.status(404).json({
        success: false,
        error: 'Persona not found',
        code: ErrorCodes.PERSONA_NOT_FOUND,
      });
      return;
    }

    const fromState = milestone.state;
    if (!isValidTransition(fromState, toState as MilestoneState)) {
      res.status(400).json({
        success: false,
        error: `Invalid transition: ${fromState} → ${toState}`,
        code: ErrorCodes.INVALID_TRANSITION,
      });
      return;
    }

    const ts = now();
    milestone.state = toState as MilestoneState;
    milestone.updatedAt = ts;

    state.governanceStore?.updateMilestoneState(milestoneId, toState as MilestoneState, ts);
    state.governanceStore?.insertHistoryEntry({
      milestoneId,
      fromState: fromState as MilestoneState,
      toState: toState as MilestoneState,
      personaId,
      timestamp: ts,
      reason,
    });

    // If milestone completed, credit token reward to the coder's account
    if (toState === 'COMPLETED' && milestone.assignedCoderPersonaId) {
      const coderPersona = state.personas.get(milestone.assignedCoderPersonaId);
      if (coderPersona && state.balanceStore && BigInt(milestone.tokenReward) > 0n) {
        state.balanceStore.creditRewards(
          ts.split('T')[0],
          [{ accountId: coderPersona.accountId, amountMicro: BigInt(milestone.tokenReward) }],
        );
      }
    }

    res.json({ success: true, milestone });
  });

  /** GET /governance/milestones/:milestoneId */
  router.get('/milestones/:milestoneId', (req: Request, res: Response) => {
    const milestoneId = req.params.milestoneId as string;
    const milestone = state.milestones.get(milestoneId);

    if (!milestone) {
      res.status(404).json({
        success: false,
        error: 'Milestone not found',
        code: ErrorCodes.MILESTONE_NOT_FOUND,
      });
      return;
    }

    const history = state.governanceStore?.getHistory(milestoneId) ?? [];

    res.json({ success: true, milestone, history });
  });

  // =========================================================================
  // Messages
  // =========================================================================

  /** POST /governance/messages */
  router.post('/messages', (req: Request, res: Response) => {
    const { fromPersonaId, toPersonaId, subject, content, milestoneId } = req.body;

    if (!fromPersonaId || !toPersonaId || !subject || !content) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: fromPersonaId, toPersonaId, subject, content',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    const from = state.personas.get(fromPersonaId);
    const to = state.personas.get(toPersonaId);
    if (!from) {
      res.status(404).json({
        success: false,
        error: 'Sender persona not found',
        code: ErrorCodes.PERSONA_NOT_FOUND,
      });
      return;
    }
    if (!to) {
      res.status(404).json({
        success: false,
        error: 'Recipient persona not found',
        code: ErrorCodes.PERSONA_NOT_FOUND,
      });
      return;
    }

    // Enforce communication matrix
    const allowed = COMMUNICATION_MATRIX[from.personaType];
    if (!allowed.includes(to.personaType)) {
      res.status(403).json({
        success: false,
        error: `${from.personaType} cannot message ${to.personaType}`,
        code: ErrorCodes.INVALID_RECIPIENT,
      });
      return;
    }

    const msg: PersonaMessage = {
      messageId: uuid(),
      fromPersonaId,
      toPersonaId,
      subject,
      content,
      milestoneId,
      createdAt: now(),
      read: false,
    };

    state.governanceStore?.insertMessage(msg);

    res.status(201).json({ success: true, message: msg });
  });

  /** GET /governance/messages?personaId=...&unread=true */
  router.get('/messages', (req: Request, res: Response) => {
    const personaId = req.query.personaId as string;

    if (!personaId) {
      res.status(400).json({
        success: false,
        error: 'Missing query parameter: personaId',
        code: ErrorCodes.MISSING_ACCOUNT_ID,
      });
      return;
    }

    const unreadOnly = req.query.unread === 'true';
    const messages = unreadOnly
      ? (state.governanceStore?.getUnreadFor(personaId) ?? [])
      : (state.governanceStore?.getMessagesFor(personaId) ?? []);

    res.json({ success: true, messages });
  });

  /** POST /governance/messages/:messageId/read */
  router.post('/messages/:messageId/read', (req: Request, res: Response) => {
    const messageId = req.params.messageId as string;
    state.governanceStore?.markRead(messageId);
    res.json({ success: true });
  });

  return router;
}
