import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { ApiState } from '../state';
import { BlockType, DEFAULT_REWARD_CONFIG } from '../../types';
import { BlockSubmission } from '../../services/serviceTypes';
import { processSubmission } from '../../services/submissionService';
import {
  TaskRecord,
  TaskSubmitRequest,
  TaskSubmitResponse,
  TaskPendingResponse,
  TaskCompleteRequest,
  TaskCompleteResponse,
  TaskResultResponse,
  TaskListResponse,
  TaskStatus,
  TaskPriority,
  ErrorCodes,
} from '../types';

const TASK_TTL_MS = 5 * 60 * 1000; // 5 minutes

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

/**
 * Insert taskId into the priority queue at the correct position.
 * Queue is sorted by priority (CRITICAL first), then by creation order.
 */
function enqueueTask(state: ApiState, taskId: string, priority: TaskPriority): void {
  const rank = PRIORITY_ORDER[priority];
  // Find insertion point: after all tasks with equal or higher priority
  let i = 0;
  for (; i < state.taskQueue.length; i++) {
    const existing = state.tasks.get(state.taskQueue[i]);
    if (existing && PRIORITY_ORDER[existing.priority] > rank) {
      break;
    }
  }
  state.taskQueue.splice(i, 0, taskId);
}

/**
 * Create router for on-demand task endpoints
 */
export function createTasksRouter(state: ApiState): Router {
  const router = Router();

  /**
   * POST /tasks/submit
   * Client submits a code generation request.
   */
  router.post('/submit', (req: Request, res: Response) => {
    const body = req.body as TaskSubmitRequest;

    if (!body.clientId || typeof body.clientId !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing clientId',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    if (!body.prompt || typeof body.prompt !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing prompt',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    const now = new Date();
    const taskId = crypto.randomUUID();
    const priority: TaskPriority = body.priority ?? 'NORMAL';
    const model = body.model ?? 'default';

    const task: TaskRecord = {
      taskId,
      clientId: body.clientId,
      status: 'PENDING',
      priority,
      prompt: body.prompt,
      systemPrompt: body.systemPrompt,
      model,
      params: body.params ?? {},
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TASK_TTL_MS).toISOString(),
    };

    state.tasks.set(taskId, task);
    state.taskSequence++;

    // Track per-client
    const clientList = state.clientTasks.get(body.clientId) ?? [];
    clientList.push(taskId);
    state.clientTasks.set(body.clientId, clientList);

    // Insert into priority queue
    enqueueTask(state, taskId, priority);

    const response: TaskSubmitResponse = {
      success: true,
      taskId,
      status: 'PENDING',
      expiresAt: task.expiresAt,
    };

    res.status(201).json(response);
  });

  /**
   * GET /tasks/pending
   * Worker polls for available tasks.
   */
  router.get('/pending', (req: Request, res: Response) => {
    const workerId = req.query.workerId as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 1, 10);

    if (!workerId) {
      res.status(400).json({
        success: false,
        error: 'Missing workerId query param',
        code: ErrorCodes.WORKER_NOT_REGISTERED,
      });
      return;
    }

    if (!state.peers.has(workerId)) {
      res.status(404).json({
        success: false,
        error: `Worker not registered: ${workerId}`,
        code: ErrorCodes.WORKER_NOT_REGISTERED,
      });
      return;
    }

    const now = new Date();
    const assigned: TaskPendingResponse['tasks'] = [];

    while (assigned.length < limit && state.taskQueue.length > 0) {
      const candidateId = state.taskQueue[0];
      const task = state.tasks.get(candidateId);

      // Skip missing or non-pending tasks
      if (!task || task.status !== 'PENDING') {
        state.taskQueue.shift();
        continue;
      }

      // Skip expired tasks
      if (new Date(task.expiresAt) <= now) {
        state.taskQueue.shift();
        task.status = 'EXPIRED';
        continue;
      }

      // Claim the task
      state.taskQueue.shift();
      task.status = 'ASSIGNED';
      task.assignedWorkerId = workerId;
      task.assignedAt = now.toISOString();

      assigned.push({
        taskId: task.taskId,
        prompt: task.prompt,
        systemPrompt: task.systemPrompt,
        model: task.model,
        params: task.params,
        priority: task.priority,
        createdAt: task.createdAt,
        expiresAt: task.expiresAt,
      });
    }

    const response: TaskPendingResponse = {
      success: true,
      tasks: assigned,
    };

    res.status(200).json(response);
  });

  /**
   * POST /tasks/complete
   * Worker submits completed task result.
   */
  router.post('/complete', (req: Request, res: Response) => {
    const body = req.body as TaskCompleteRequest;

    if (!body.workerId || !body.taskId) {
      res.status(400).json({
        success: false,
        error: 'Missing workerId or taskId',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    const task = state.tasks.get(body.taskId);
    if (!task) {
      res.status(404).json({
        success: false,
        error: `Task not found: ${body.taskId}`,
        code: ErrorCodes.TASK_NOT_FOUND,
      });
      return;
    }

    if (task.status === 'COMPLETED' || task.status === 'FAILED') {
      res.status(409).json({
        success: false,
        error: 'Task already completed',
        code: ErrorCodes.TASK_ALREADY_COMPLETED,
      });
      return;
    }

    if (task.assignedWorkerId !== body.workerId) {
      res.status(403).json({
        success: false,
        error: 'Task not assigned to this worker',
        code: ErrorCodes.TASK_ALREADY_ASSIGNED,
      });
      return;
    }

    // Update task record
    const now = new Date();
    const isError = body.finishReason === 'error' || !!body.error;

    task.status = isError ? 'FAILED' : 'COMPLETED';
    task.output = body.output;
    task.finishReason = body.finishReason;
    task.tokenUsage = body.tokenUsage;
    task.executionTimeMs = body.executionTimeMs;
    task.error = body.error;
    task.completedAt = now.toISOString();

    // Direct reward: 1 AI token consumed = 1 nanounit (0.000000001 crypto tokens)
    let blockId: string | undefined;
    let rewardNano: bigint | undefined;

    if (!isError && state.dayPhase === 'ACTIVE' && state.currentDayId) {
      const peer = state.peers.get(body.workerId);
      if (peer && state.currentRosterAccountIds.includes(peer.accountId)) {
        blockId = `task-${task.taskId}`;
        task.blockId = blockId;

        const totalTokens = body.tokenUsage?.totalTokens ?? 0;
        rewardNano = BigInt(totalTokens); // 1:1 AI token → nanounit

        // Still create a BlockSubmission for the daily event log
        const submission: BlockSubmission = {
          contributorId: peer.accountId,
          blockId,
          blockType: BlockType.INFERENCE,
          resourceUsage: Math.min(1.0, Math.max(0.1, totalTokens / 4096)),
          difficultyMultiplier: 1.0,
          validationPassed: true,
          timestamp: now,
          tokenUsage: body.tokenUsage,
        };

        const contributor = state.networkState.contributors.get(peer.accountId);
        if (contributor) {
          const result = processSubmission(
            contributor,
            submission,
            false,  // not a canary
            DEFAULT_REWARD_CONFIG
          );
          state.networkState.contributors.set(peer.accountId, result.contributor);
          state.pendingSubmissions.push(submission);
        }

        // Credit reward directly to balance ledger (1 AI token = 1 nanounit)
        if (rewardNano > 0n && state.balanceLedger) {
          state.balanceLedger.creditRewards(state.currentDayId, [{
            accountId: peer.accountId,
            amountMicro: rewardNano,
          }]);
        }
      }
    }

    const response: TaskCompleteResponse = {
      success: true,
      taskId: task.taskId,
      blockId,
      rewardNano: rewardNano?.toString(),
    };

    res.status(200).json(response);
  });

  /**
   * GET /tasks/:taskId/result
   * Client retrieves task result.
   */
  router.get('/:taskId/result', (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;

    const task = state.tasks.get(taskId);
    if (!task) {
      res.status(404).json({
        success: false,
        error: `Task not found: ${taskId}`,
        code: ErrorCodes.TASK_NOT_FOUND,
      });
      return;
    }

    const response: TaskResultResponse = {
      success: true,
      task,
    };

    res.status(200).json(response);
  });

  /**
   * GET /tasks/list
   * Client lists their tasks with optional filters.
   */
  router.get('/list', (req: Request, res: Response) => {
    const clientId = req.query.clientId as string;
    const statusFilter = req.query.status as TaskStatus | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    if (!clientId) {
      res.status(400).json({
        success: false,
        error: 'Missing clientId query param',
        code: ErrorCodes.INTERNAL_ERROR,
      });
      return;
    }

    const taskIds = state.clientTasks.get(clientId) ?? [];
    const tasks: TaskRecord[] = [];

    // Iterate in reverse (newest first)
    for (let i = taskIds.length - 1; i >= 0 && tasks.length < limit; i--) {
      const task = state.tasks.get(taskIds[i]);
      if (!task) continue;
      if (statusFilter && task.status !== statusFilter) continue;
      tasks.push(task);
    }

    const response: TaskListResponse = {
      success: true,
      tasks,
    };

    res.status(200).json(response);
  });

  return router;
}
