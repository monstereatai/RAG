import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AgentLoopResumeError } from '../agent-loop/agent-loop.types';
import { CodingTaskService } from './coding-task.service';

const taskId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const ownerUserId = 'owner-1';
const tenantId = 'tenant-1';
const threadId = 'thread-1';
const requestId = '33333333-3333-4333-8333-333333333333';
const body = {
  artifactId: 'artifact-1',
  instruction: '修复 lint 并运行测试',
  requestId,
};

function createService() {
  const tasks = {
    findCodingTaskByRequest: jest.fn().mockResolvedValue(null),
    createCodingTask: jest.fn().mockImplementation(async (input) => ({
      id: input.id,
      threadId: input.threadId,
      runId: input.runId,
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      requestId: input.requestId,
      requestHash: input.requestHash,
      taskType: 'coding_task',
      status: 'queued',
      retryCount: 0,
      codingContext: JSON.stringify({
        source: 'zip',
        artifactId: input.artifactId,
        instruction: input.instruction,
      }),
    })),
    findOwnedCodingTask: jest.fn(),
    findById: jest.fn(),
    updateCodingTask: jest.fn(),
    ensureCodingTaskEvent: jest.fn().mockResolvedValue(undefined),
  };
  const runs = {
    start: jest.fn().mockResolvedValue({
      id: runId,
      threadId,
      tenantId,
      mode: 'coding',
      status: 'running',
    }),
    ensureStartedEvent: jest.fn().mockResolvedValue(undefined),
    prepareCodingResume: jest.fn(),
    ensureCodingResumeEvent: jest.fn(),
    cancel: jest.fn(),
    finish: jest.fn(),
  };
  const runtimeEvents = { list: jest.fn().mockResolvedValue([]) };
  const domainEvents = {
    transaction: jest.fn(async (callback) => callback({ transaction: true })),
    emitInTransaction: jest.fn().mockResolvedValue(undefined),
  };
  const queue = { registerCodingTaskProcessor: jest.fn() };
  const workspaceAgent = {
    run: jest.fn(),
    runWithExecutionOptions: jest.fn(),
    assertCanResume: jest.fn().mockResolvedValue(undefined),
  };
  const workspace = {
    validateCodingArtifact: jest.fn().mockResolvedValue(undefined),
    assertWorkspaceReady: jest.fn().mockResolvedValue(undefined),
    verifyWorkspace: jest.fn(),
  };
  const service = new CodingTaskService(
    tasks as never,
    runs as never,
    runtimeEvents as never,
    domainEvents as never,
    queue as never,
    workspaceAgent as never,
    workspace as never,
  );
  return { service, tasks, runs, runtimeEvents, domainEvents, queue, workspaceAgent, workspace };
}

describe('CodingTaskService', () => {
  it('creates run, task, and dispatch outbox in one transaction', async () => {
    const { service, tasks, runs, domainEvents } = createService();

    const accepted = await service.submit({ threadId, ownerUserId, tenantId, body });
    expect(accepted).toMatchObject({ runId, status: 'queued' });
    expect(accepted.taskId).toMatch(/^[a-f0-9-]{36}$/i);

    expect(domainEvents.transaction).toHaveBeenCalledTimes(1);
    expect(runs.start).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId,
        userId: ownerUserId,
        tenantId,
        mode: 'coding',
      }),
      expect.anything(),
    );
    expect(tasks.createCodingTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: accepted.taskId,
        threadId,
        runId,
        ownerUserId,
        requestId,
      }),
      expect.anything(),
    );
    expect(domainEvents.emitInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'workflow.dispatch.requested',
        aggregateId: threadId,
        payload: expect.objectContaining({
          job: expect.objectContaining({
            operation: 'coding_task',
            taskId: accepted.taskId,
            taskAttempt: 0,
            resume: false,
          }),
        }),
      }),
    );
    expect(runs.ensureStartedEvent).toHaveBeenCalled();
    expect(tasks.createCodingTask).toHaveBeenCalled();
  });

  it('returns an existing task for the same request and rejects changed input', async () => {
    const { service, tasks, domainEvents } = createService();
    const requestHash = createHash('sha256')
      .update(JSON.stringify([tenantId, ownerUserId, threadId, body.artifactId, body.instruction]))
      .digest('hex');
    const accepted = {
      id: taskId,
      runId,
      threadId,
      requestHash,
      status: 'running',
    };
    tasks.findCodingTaskByRequest.mockResolvedValue(accepted);
    const first = await service.submit({ threadId, ownerUserId, tenantId, body });
    expect(first).toMatchObject({ taskId, runId, status: 'running' });
    expect(domainEvents.transaction).not.toHaveBeenCalled();

    await expect(
      service.submit({
        threadId,
        ownerUserId,
        tenantId,
        body: { ...body, instruction: '改成其他任务' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('scopes task status reads to owner, tenant, and thread', async () => {
    const { service, tasks, runtimeEvents } = createService();
    tasks.findOwnedCodingTask.mockResolvedValue({
      id: taskId,
      runId,
      threadId,
      tenantId,
      status: 'running',
      retryCount: 0,
      codingContext: '{}',
      verification: null,
    });

    await service.get({ taskId, threadId, ownerUserId, tenantId });

    expect(tasks.findOwnedCodingTask).toHaveBeenCalledWith(
      taskId,
      ownerUserId,
      tenantId,
      threadId,
    );
    expect(runtimeEvents.list).toHaveBeenCalledWith(
      threadId,
      runId,
      tenantId,
      undefined,
      200,
    );
  });

  it('does not mark a task cancelled when the run already reached another terminal state', async () => {
    const { service, tasks, runs } = createService();
    tasks.findOwnedCodingTask.mockResolvedValue({
      id: taskId,
      runId,
      threadId,
      tenantId,
      status: 'completed',
    });
    runs.cancel.mockResolvedValue({ id: runId, status: 'completed' });

    await expect(
      service.cancel({ taskId, threadId, ownerUserId, tenantId }),
    ).resolves.toMatchObject({ taskId, runId, status: 'completed' });
    expect(tasks.updateCodingTask).not.toHaveBeenCalled();
  });

  it('blocks manual resume after an unknown tool side effect', async () => {
    const { service, tasks, runs, runtimeEvents, domainEvents } = createService();
    tasks.findOwnedCodingTask.mockResolvedValue({
      id: taskId,
      runId,
      threadId,
      tenantId,
      status: 'failed',
      retryCount: 0,
    });
    runtimeEvents.list.mockResolvedValue([{ eventType: 'tool.unknown' }]);

    await expect(
      service.resume({ taskId, threadId, ownerUserId, tenantId }),
    ).rejects.toThrow('unknown or stale side effect');
    expect(runs.prepareCodingResume).not.toHaveBeenCalled();
    expect(domainEvents.transaction).not.toHaveBeenCalled();
  });

  it('moves a task to reconciliation when its same-run checkpoint is missing', async () => {
    const { service, tasks, workspaceAgent, domainEvents } = createService();
    tasks.findOwnedCodingTask.mockResolvedValue({
      id: taskId,
      runId,
      threadId,
      tenantId,
      ownerUserId,
      status: 'failed',
      retryCount: 0,
      codingContext: JSON.stringify({
        source: 'zip',
        artifactId: 'artifact-1',
        instruction: '修复 lint',
      }),
    });
    tasks.updateCodingTask.mockResolvedValue({
      id: taskId,
      runId,
      threadId,
      tenantId,
      ownerUserId,
      status: 'waiting_reconciliation',
      retryCount: 0,
    });
    workspaceAgent.assertCanResume.mockRejectedValue(
      new AgentLoopResumeError('missing_checkpoint', '未找到检查点'),
    );

    await expect(
      service.resume({ taskId, threadId, ownerUserId, tenantId }),
    ).rejects.toThrow('未找到检查点');
    expect(tasks.updateCodingTask).toHaveBeenCalledWith(
      taskId,
      expect.objectContaining({ status: 'waiting_reconciliation' }),
    );
    expect(domainEvents.transaction).not.toHaveBeenCalled();
  });

  it('uses deterministic checks before marking a model-complete task as completed', async () => {
    const { service, tasks, runs, queue, workspaceAgent, workspace } = createService();
    const workerTask = {
      id: taskId,
      runId,
      threadId,
      tenantId,
      ownerUserId,
      requestId,
      requestHash: 'hash-1',
      taskType: 'coding_task',
      status: 'queued',
      retryCount: 0,
      codingContext: JSON.stringify({
        source: 'zip',
        artifactId: 'artifact-1',
        instruction: '修复 lint',
      }),
    };
    tasks.findById
      .mockResolvedValueOnce(workerTask)
      .mockResolvedValueOnce({ ...workerTask, status: 'running' });
    tasks.updateCodingTask.mockResolvedValue({ ...workerTask, status: 'running' });
    tasks.updateCodingTask.mockResolvedValueOnce({ ...workerTask, status: 'running' });
    tasks.updateCodingTask.mockResolvedValueOnce({ ...workerTask, status: 'waiting_review' });
    workspaceAgent.runWithExecutionOptions.mockResolvedValue({
      summary: '实现完成',
      status: 'completed',
      steps: [{ command: 'npm run lint', exitCode: 0, output: 'ok' }],
      toolCalls: 1,
    });
    workspace.verifyWorkspace.mockResolvedValue({
      checkedAt: new Date().toISOString(),
      diff: { added: [], modified: [], deleted: [] },
      checks: {
        lint: { status: 'not_applicable', command: null, exitCode: null, output: '' },
        test: { status: 'not_applicable', command: null, exitCode: null, output: '' },
        build: { status: 'not_applicable', command: null, exitCode: null, output: '' },
      },
    });
    runs.finish.mockResolvedValue({ id: runId, status: 'completed' });

    const serviceWithWorker = service as unknown as {
      onModuleInit(): void;
    };
    serviceWithWorker.onModuleInit();
    const processor = queue.registerCodingTaskProcessor.mock.calls[0][0];
    await processor(
      {
        id: `production-workflow-coding_task-${taskId.replace(/-/g, '')}-r0`,
        operation: 'coding_task',
        taskId,
        taskAttempt: 0,
        resume: false,
        threadId,
        userId: ownerUserId,
        tenantId,
      },
      { attempt: 1, finalAttempt: true },
    );

    expect(workspaceAgent.runWithExecutionOptions).toHaveBeenCalledWith(
      threadId,
      ownerUserId,
      tenantId,
      'artifact-1',
      '修复 lint',
      { runId, taskId, resume: false },
    );
    expect(tasks.updateCodingTask).toHaveBeenLastCalledWith(
      taskId,
      expect.objectContaining({ status: 'waiting_review' }),
    );
    expect(runs.finish).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('does not overwrite cancellation when a verification result arrives late', async () => {
    const { service, tasks, runs, queue, workspaceAgent, workspace } = createService();
    const workerTask = {
      id: taskId,
      runId,
      threadId,
      tenantId,
      ownerUserId,
      taskType: 'coding_task',
      status: 'queued',
      retryCount: 0,
      codingContext: JSON.stringify({
        source: 'zip',
        artifactId: 'artifact-1',
        instruction: '修复 lint',
      }),
    };
    tasks.findById
      .mockResolvedValueOnce(workerTask)
      .mockResolvedValueOnce({ ...workerTask, status: 'cancelled' });
    tasks.updateCodingTask.mockResolvedValue({ ...workerTask, status: 'running' });
    workspaceAgent.runWithExecutionOptions.mockResolvedValue({
      summary: '迟到的完成结果',
      status: 'completed',
      steps: [],
      toolCalls: 0,
    });
    workspace.verifyWorkspace.mockResolvedValue({
      checkedAt: new Date().toISOString(),
      diff: { added: [{ path: 'src/a.ts', sha256: 'hash' }], modified: [], deleted: [] },
      checks: {
        lint: { status: 'passed', command: 'npm run lint', exitCode: 0, output: '' },
        test: { status: 'passed', command: 'npm run test', exitCode: 0, output: '' },
        build: { status: 'passed', command: 'npm run build', exitCode: 0, output: '' },
      },
    });
    runs.finish.mockResolvedValue({ id: runId, status: 'cancelled' });

    service.onModuleInit();
    const processor = queue.registerCodingTaskProcessor.mock.calls[0][0];
    await processor(
      {
        id: `production-workflow-coding_task-${taskId.replace(/-/g, '')}-r0`,
        operation: 'coding_task',
        taskId,
        taskAttempt: 0,
        resume: false,
        threadId,
        userId: ownerUserId,
        tenantId,
      },
      { attempt: 1, finalAttempt: true },
    );

    expect(tasks.updateCodingTask).toHaveBeenCalledTimes(1);
    expect(tasks.ensureCodingTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
      'task.cancelled',
      expect.objectContaining({ status: 'cancelled' }),
      expect.any(String),
    );
  });

  it('requires reconciliation when a blocked Loop reports an unknown tool result', async () => {
    const { service, tasks, runs, runtimeEvents, queue, workspaceAgent } = createService();
    const workerTask = {
      id: taskId,
      runId,
      threadId,
      tenantId,
      ownerUserId,
      taskType: 'coding_task',
      status: 'queued',
      retryCount: 0,
      codingContext: JSON.stringify({
        source: 'zip',
        artifactId: 'artifact-1',
        instruction: '修复 lint',
      }),
    };
    tasks.findById
      .mockResolvedValueOnce(workerTask)
      .mockResolvedValueOnce({ ...workerTask, status: 'running' });
    tasks.updateCodingTask
      .mockResolvedValueOnce({ ...workerTask, status: 'running' })
      .mockResolvedValueOnce({ ...workerTask, status: 'waiting_reconciliation' });
    workspaceAgent.runWithExecutionOptions.mockResolvedValue({
      summary: '工具执行结果未知',
      status: 'blocked',
      steps: [],
      toolCalls: 1,
    });
    runtimeEvents.list.mockResolvedValue([{ eventType: 'tool.unknown' }]);
    runs.finish.mockResolvedValue({ id: runId, status: 'failed' });

    service.onModuleInit();
    const processor = queue.registerCodingTaskProcessor.mock.calls[0][0];
    await processor(
      {
        id: `production-workflow-coding_task-${taskId.replace(/-/g, '')}-r0`,
        operation: 'coding_task',
        taskId,
        taskAttempt: 0,
        resume: false,
        threadId,
        userId: ownerUserId,
        tenantId,
      },
      { attempt: 1, finalAttempt: true },
    );

    expect(tasks.updateCodingTask).toHaveBeenLastCalledWith(
      taskId,
      expect.objectContaining({ status: 'waiting_reconciliation' }),
    );
    expect(runs.finish).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
