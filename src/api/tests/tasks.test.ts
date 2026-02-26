import request from 'supertest';
import { createApp } from '../app';
import { createApiState, ApiState } from '../state';
import { createInMemoryStores } from '../../persistence/inMemoryStores';
import { ErrorCodes } from '../types';
import { makeTestNode, signWorkerRequest } from './helpers';

describe('/tasks endpoints', () => {
  let state: ApiState;
  let app: ReturnType<typeof createApp>;
  let workerId: string;

  beforeEach(async () => {
    const stores = createInMemoryStores();
    state = createApiState(stores);
    app = createApp(state);

    const workerNode = await makeTestNode();
    await request(app)
      .post('/nodes/register')
      .send({ accountId: workerNode.accountId, publicKey: workerNode.publicKeyHex });

    const peerAuth = await signWorkerRequest(workerNode.accountId, workerNode.secretKeyHex);
    const peerRes = await request(app)
      .post('/peers/register')
      .send({
        accountId: workerNode.accountId,
        ...peerAuth,
        listenAddr: '127.0.0.1:9100',
      });
    workerId = peerRes.body.workerId;
  });

  describe('POST /tasks/submit', () => {
    it('should create a task and return taskId', async () => {
      const res = await request(app)
        .post('/tasks/submit')
        .send({
          clientId: 'client-1',
          prompt: 'Write hello world in Python',
          model: 'gpt-4o',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.taskId).toBeDefined();
      expect(res.body.status).toBe('PENDING');
      expect(res.body.expiresAt).toBeDefined();
    });

    it('should reject missing clientId', async () => {
      const res = await request(app)
        .post('/tasks/submit')
        .send({ prompt: 'test' });

      expect(res.status).toBe(400);
    });

    it('should reject missing prompt', async () => {
      const res = await request(app)
        .post('/tasks/submit')
        .send({ clientId: 'client-1' });

      expect(res.status).toBe(400);
    });

    it('should default model to "default"', async () => {
      const res = await request(app)
        .post('/tasks/submit')
        .send({ clientId: 'c1', prompt: 'test' });

      const task = state.tasks.get(res.body.taskId);
      expect(task?.model).toBe('default');
    });

    it('should add task to queue', async () => {
      await request(app)
        .post('/tasks/submit')
        .send({ clientId: 'c1', prompt: 'test' });

      expect(state.taskQueue).toHaveLength(1);
    });
  });

  describe('GET /tasks/pending', () => {
    it('should return empty list when no tasks queued', async () => {
      const res = await request(app)
        .get(`/tasks/pending?workerId=${workerId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tasks).toHaveLength(0);
    });

    it('should assign a pending task to a worker', async () => {
      const submitRes = await request(app)
        .post('/tasks/submit')
        .send({ clientId: 'c1', prompt: 'Write code', model: 'gpt-4o' });
      const taskId = submitRes.body.taskId;

      const res = await request(app)
        .get(`/tasks/pending?workerId=${workerId}`);

      expect(res.status).toBe(200);
      expect(res.body.tasks).toHaveLength(1);
      expect(res.body.tasks[0].taskId).toBe(taskId);
      expect(res.body.tasks[0].prompt).toBe('Write code');
      expect(res.body.tasks[0].model).toBe('gpt-4o');

      const task = state.tasks.get(taskId);
      expect(task?.status).toBe('ASSIGNED');
      expect(task?.assignedWorkerId).toBe(workerId);
      expect(state.taskQueue).toHaveLength(0);
    });

    it('should reject unregistered worker', async () => {
      const res = await request(app)
        .get('/tasks/pending?workerId=fake-worker');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ErrorCodes.WORKER_NOT_REGISTERED);
    });

    it('should skip expired tasks', async () => {
      const submitRes = await request(app)
        .post('/tasks/submit')
        .send({ clientId: 'c1', prompt: 'test' });
      const taskId = submitRes.body.taskId;

      const task = state.tasks.get(taskId)!;
      task.expiresAt = new Date(Date.now() - 1000).toISOString();

      const res = await request(app)
        .get(`/tasks/pending?workerId=${workerId}`);

      expect(res.body.tasks).toHaveLength(0);
      expect(state.tasks.get(taskId)?.status).toBe('EXPIRED');
    });

    it('should respect priority ordering', async () => {
      await request(app)
        .post('/tasks/submit')
        .send({ clientId: 'c1', prompt: 'low priority', priority: 'LOW' });
      await request(app)
        .post('/tasks/submit')
        .send({ clientId: 'c1', prompt: 'high priority', priority: 'HIGH' });

      const res = await request(app)
        .get(`/tasks/pending?workerId=${workerId}&limit=2`);

      expect(res.body.tasks).toHaveLength(2);
      expect(res.body.tasks[0].prompt).toBe('high priority');
      expect(res.body.tasks[1].prompt).toBe('low priority');
    });
  });

  describe('POST /tasks/complete', () => {
    let taskId: string;

    beforeEach(async () => {
      const submitRes = await request(app)
        .post('/tasks/submit')
        .send({ clientId: 'c1', prompt: 'Write code' });
      taskId = submitRes.body.taskId;

      await request(app)
        .get(`/tasks/pending?workerId=${workerId}`);
    });

    it('should complete a task with output', async () => {
      const res = await request(app)
        .post('/tasks/complete')
        .send({
          workerId,
          taskId,
          output: 'print("hello world")',
          finishReason: 'stop',
          tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          executionTimeMs: 250,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.taskId).toBe(taskId);

      const task = state.tasks.get(taskId);
      expect(task?.status).toBe('COMPLETED');
      expect(task?.output).toBe('print("hello world")');
      expect(task?.finishReason).toBe('stop');
    });

    it('should mark task as FAILED on error', async () => {
      const res = await request(app)
        .post('/tasks/complete')
        .send({
          workerId,
          taskId,
          output: '',
          finishReason: 'error',
          error: 'API rate limited',
        });

      expect(res.status).toBe(200);
      const task = state.tasks.get(taskId);
      expect(task?.status).toBe('FAILED');
      expect(task?.error).toBe('API rate limited');
    });

    it('should reject completion by wrong worker', async () => {
      const res = await request(app)
        .post('/tasks/complete')
        .send({
          workerId: 'other-worker',
          taskId,
          output: 'test',
          finishReason: 'stop',
        });

      expect(res.status).toBe(403);
    });

    it('should reject double completion', async () => {
      await request(app)
        .post('/tasks/complete')
        .send({ workerId, taskId, output: 'done', finishReason: 'stop' });

      const res = await request(app)
        .post('/tasks/complete')
        .send({ workerId, taskId, output: 'done again', finishReason: 'stop' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ErrorCodes.TASK_ALREADY_COMPLETED);
    });

    it('should reject unknown taskId', async () => {
      const res = await request(app)
        .post('/tasks/complete')
        .send({ workerId, taskId: 'nonexistent', output: 'x', finishReason: 'stop' });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /tasks/:taskId/result', () => {
    it('should return task details', async () => {
      const submitRes = await request(app)
        .post('/tasks/submit')
        .send({ clientId: 'c1', prompt: 'test prompt', model: 'gpt-4o' });
      const taskId = submitRes.body.taskId;

      const res = await request(app)
        .get(`/tasks/${taskId}/result`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.task.taskId).toBe(taskId);
      expect(res.body.task.prompt).toBe('test prompt');
      expect(res.body.task.status).toBe('PENDING');
    });

    it('should return 404 for unknown task', async () => {
      const res = await request(app)
        .get('/tasks/nonexistent/result');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /tasks/list', () => {
    it('should list tasks for a client', async () => {
      await request(app)
        .post('/tasks/submit')
        .send({ clientId: 'c1', prompt: 'task 1' });
      await request(app)
        .post('/tasks/submit')
        .send({ clientId: 'c1', prompt: 'task 2' });
      await request(app)
        .post('/tasks/submit')
        .send({ clientId: 'c2', prompt: 'other client' });

      const res = await request(app)
        .get('/tasks/list?clientId=c1');

      expect(res.status).toBe(200);
      expect(res.body.tasks).toHaveLength(2);
    });

    it('should filter by status', async () => {
      await request(app)
        .post('/tasks/submit')
        .send({ clientId: 'c1', prompt: 'task 1' });
      await request(app)
        .post('/tasks/submit')
        .send({ clientId: 'c1', prompt: 'task 2' });

      await request(app)
        .get(`/tasks/pending?workerId=${workerId}&limit=1`);

      const res = await request(app)
        .get('/tasks/list?clientId=c1&status=PENDING');

      expect(res.body.tasks).toHaveLength(1);
      expect(res.body.tasks[0].status).toBe('PENDING');
    });

    it('should reject missing clientId', async () => {
      const res = await request(app).get('/tasks/list');

      expect(res.status).toBe(400);
    });
  });

  describe('Full lifecycle: submit → poll → complete → retrieve', () => {
    it('should complete the full task lifecycle', async () => {
      const submitRes = await request(app)
        .post('/tasks/submit')
        .send({
          clientId: 'client-app',
          prompt: 'Write a fibonacci function in TypeScript',
          systemPrompt: 'You are a code generator. Output only code.',
          model: 'gpt-4o',
          params: { max_tokens: 256, temperature: 0.2 },
          priority: 'HIGH',
        });

      expect(submitRes.status).toBe(201);
      const taskId = submitRes.body.taskId;

      const pollRes = await request(app)
        .get(`/tasks/pending?workerId=${workerId}`);

      expect(pollRes.body.tasks).toHaveLength(1);
      expect(pollRes.body.tasks[0].taskId).toBe(taskId);
      expect(pollRes.body.tasks[0].systemPrompt).toBe('You are a code generator. Output only code.');

      const completeRes = await request(app)
        .post('/tasks/complete')
        .send({
          workerId,
          taskId,
          output: 'function fibonacci(n: number): number {\n  if (n <= 1) return n;\n  return fibonacci(n - 1) + fibonacci(n - 2);\n}',
          finishReason: 'stop',
          tokenUsage: { promptTokens: 25, completionTokens: 40, totalTokens: 65 },
          executionTimeMs: 1200,
        });

      expect(completeRes.status).toBe(200);

      const resultRes = await request(app)
        .get(`/tasks/${taskId}/result`);

      expect(resultRes.status).toBe(200);
      expect(resultRes.body.task.status).toBe('COMPLETED');
      expect(resultRes.body.task.output).toContain('fibonacci');
      expect(resultRes.body.task.finishReason).toBe('stop');
      expect(resultRes.body.task.executionTimeMs).toBe(1200);
    });
  });
});
