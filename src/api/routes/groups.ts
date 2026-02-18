import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { ApiState } from '../state';
import {
  GroupCreateRequest,
  GroupCreateResponse,
  GroupListResponse,
  WorkGroupInfo,
  GroupMemberInfo,
  ErrorCodes,
} from '../types';
import { requireAdminKey } from '../middleware/adminAuth';

/**
 * Create router for work group management endpoints
 */
export function createGroupsRouter(state: ApiState): Router {
  const router = Router();

  /**
   * POST /groups/create
   * Admin creates a work group and assigns workers to it.
   * Workers are notified via the /groups/mine endpoint on next poll.
   */
  router.post('/create', requireAdminKey, (req: Request, res: Response) => {
    const body = req.body as GroupCreateRequest;

    if (!body.purpose) {
      res.status(400).json({
        success: false,
        error: 'Missing purpose',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    if (!body.workerIds || !Array.isArray(body.workerIds) || body.workerIds.length < 2) {
      res.status(400).json({
        success: false,
        error: 'Need at least 2 workerIds',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    // Verify all workers exist in peer registry
    for (const wid of body.workerIds) {
      if (!state.peers.has(wid)) {
        res.status(404).json({
          success: false,
          error: `Worker not found in peer registry: ${wid}`,
          code: ErrorCodes.GROUP_MEMBER_NOT_FOUND,
        });
        return;
      }
    }

    const groupId = `group-${crypto.randomUUID().substring(0, 8)}`;

    // First member is coordinator, rest are members
    const members: GroupMemberInfo[] = body.workerIds.map((wid, index) => {
      const member: GroupMemberInfo = {
        workerId: wid,
        role: index === 0 ? 'coordinator' : 'member',
      };

      if (body.purpose === 'MODEL_SHARD') {
        member.shardIndex = index;
      } else if (body.purpose === 'TASK_PIPELINE') {
        member.pipelineStage = index;
      }

      return member;
    });

    const group: WorkGroupInfo = {
      groupId,
      purpose: body.purpose,
      modelId: body.modelId,
      totalShards: body.purpose === 'MODEL_SHARD' ? body.workerIds.length : undefined,
      members,
      createdAt: new Date().toISOString(),
    };

    state.workGroups.set(groupId, group);

    const response: GroupCreateResponse = {
      success: true,
      group,
    };

    res.status(201).json(response);
  });

  /**
   * GET /groups
   * Admin lists all active work groups.
   */
  router.get('/', requireAdminKey, (_req: Request, res: Response) => {
    const groups: WorkGroupInfo[] = [];
    for (const [, group] of state.workGroups) {
      groups.push(group);
    }

    const response: GroupListResponse = {
      success: true,
      groups,
    };

    res.status(200).json(response);
  });

  /**
   * GET /groups/mine?workerId=<id>
   * Worker queries which groups it belongs to.
   * This is the poll-based equivalent of PEER_DIRECTORY / GROUP_ASSIGNED messages.
   */
  router.get('/mine', (req: Request, res: Response) => {
    const workerId = req.query.workerId as string;

    if (!workerId) {
      res.status(400).json({
        success: false,
        error: 'Missing workerId query param',
        code: ErrorCodes.PEER_NOT_FOUND,
      });
      return;
    }

    const myGroups: WorkGroupInfo[] = [];
    for (const [, group] of state.workGroups) {
      if (group.members.some(m => m.workerId === workerId)) {
        myGroups.push(group);
      }
    }

    res.status(200).json({
      success: true,
      groups: myGroups,
    });
  });

  /**
   * GET /groups/:groupId
   * Get details of a specific work group.
   */
  router.get('/:groupId', (req: Request, res: Response) => {
    const groupId = req.params.groupId as string;

    const group = state.workGroups.get(groupId);
    if (!group) {
      res.status(404).json({
        success: false,
        error: `Group not found: ${groupId}`,
        code: ErrorCodes.GROUP_NOT_FOUND,
      });
      return;
    }

    res.status(200).json({ success: true, group });
  });

  /**
   * DELETE /groups/:groupId
   * Admin dissolves a work group.
   */
  router.delete('/:groupId', requireAdminKey, (req: Request, res: Response) => {
    const groupId = req.params.groupId as string;

    if (!state.workGroups.has(groupId)) {
      res.status(404).json({
        success: false,
        error: `Group not found: ${groupId}`,
        code: ErrorCodes.GROUP_NOT_FOUND,
      });
      return;
    }

    state.workGroups.delete(groupId);
    res.status(200).json({ success: true });
  });

  return router;
}
