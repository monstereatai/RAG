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
        role: input.role,
        task: input.task,
        strictRole: input.strictRole,
        parentRunId: input.parentRunId,
      }),
      outputArtifactId: null,
    })),
    findOwnedCodingTask: jest.fn(),
    findById: jest.fn(),
    updateCodingTask: jest.fn(),
    transitionCodingTask: jest.fn(),
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
    assertWorkspaceTaskLeaseOwned: jest.fn().mockResolvedValue(undefined),
    withWorkspaceTaskLease: jest.fn(
      async (
        _threadId: string,
        _userId: string,
        _tenantId: string | undefined,
        callback: () => Promise<unknown>,
      ) => callback(),
    ),
    validateCodingArtifact: jest.fn().mockResolvedValue({ runId: 'parent-run' }),
    assertWorkspaceReady: jest.fn().mockResolvedValue(undefined),
    verifyWorkspace: jest.fn(),
    exportWorkspace: jest.fn().mockResolvedValue({ id: 'coding-output-artifact' }),
  };
  const testAgent = {
    runWithExecutionOptions: jest.fn(),
    assertCanResume: jest.fn().mockResolvedValue(undefined),
  };
  const artifacts = {
    createStudioVersion: jest.fn().mockImplementation(async (input) => ({
      id: input.metadata.target === 'qa-logs' ? 'qa-logs-artifact' : 'qa-report-artifact',
    })),
    listStudioVersions: jest.fn().mockResolvedValue([]),
    getOwned: jest.fn(),
    getFileOwned: jest.fn(),
  };
  const service = new CodingTaskService(
    tasks as never,
    runs as never,
    runtimeEvents as never,
    domainEvents as never,
    queue as never,
    workspaceAgent as never,
    workspace as never,
    testAgent as never,
    artifacts as never,
  );
  return {
    service,
    tasks,
    runs,
    runtimeEvents,
    domainEvents,
    queue,
    workspaceAgent,
    workspace,
    testAgent,
    artifacts,
  };
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
      .update(
        JSON.stringify([
          tenantId,
          ownerUserId,
          threadId,
          'frontend',
          'code',
          false,
          body.artifactId,
          body.instruction,
        ]),
      )
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

  it('rejects reusing a request id after changing its execution role', async () => {
    const { service, tasks, domainEvents } = createService();
    const frontendBody = { ...body, role: 'frontend' as const, task: 'code' as const };
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify([
          tenantId,
          ownerUserId,
          threadId,
          'frontend',
          'code',
          true,
          body.artifactId,
          body.instruction,
        ]),
      )
      .digest('hex');
    tasks.findCodingTaskByRequest.mockResolvedValue({
      id: taskId,
      runId,
      threadId,
      requestHash,
      status: 'queued',
    });

    await expect(
      service.submit({
        threadId,
        ownerUserId,
        tenantId,
        body: frontendBody,
      }),
    ).resolves.toMatchObject({ taskId, runId, status: 'queued' });
    await expect(
      service.submit({
        threadId,
        ownerUserId,
        tenantId,
        body: { ...body, role: 'backend', task: 'code' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(domainEvents.transaction).not.toHaveBeenCalled();
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
      codingContext: JSON.stringify({
        source: 'zip',
        artifactId: body.artifactId,
        instruction: body.instruction,
      }),
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

  it('scopes QA report downloads to the owning tenant and task', async () => {
    const { service, tasks, artifacts } = createService();
    const file = { artifact: { filename: 'qa-report.json' }, body: Buffer.from('{}') };
    tasks.findOwnedCodingTask.mockResolvedValue({
      id: taskId,
      threadId,
      tenantId,
      ownerUserId,
      codingContext: JSON.stringify({
        source: 'zip', artifactId: 'artifact-1', instruction: '检查项目', role: 'qa', task: 'verify',
      }),
      outputArtifactId: 'report-1',
    });
    artifacts.getOwned.mockResolvedValue({
      id: 'report-1',
      status: 'ready',
      threadId,
      tenantId,
      metadata: JSON.stringify({ studio: 'qa', target: 'qa-report', role: 'qa', taskType: 'verify', taskId }),
    });
    artifacts.getFileOwned.mockResolvedValue(file);

    await expect(
      service.getReportFile({ taskId, threadId, ownerUserId, tenantId }),
    ).resolves.toBe(file);
    expect(artifacts.getFileOwned).toHaveBeenCalledWith('report-1', ownerUserId);

    artifacts.getOwned.mockResolvedValueOnce({
      id: 'report-1',
      status: 'ready',
      threadId,
      tenantId: 'other-tenant',
      metadata: JSON.stringify({ studio: 'qa', target: 'qa-report', role: 'qa', taskType: 'verify', taskId }),
    });
    await expect(
      service.getReportFile({ taskId, threadId, ownerUserId, tenantId }),
    ).rejects.toThrow('QA qa-report artifact identity mismatch');
  });

  it('downloads QA logs only when their artifact belongs to the same task scope', async () => {
    const { service, tasks, artifacts } = createService();
    const file = { artifact: { filename: 'qa-logs.json' }, body: Buffer.from('{}') };
    tasks.findOwnedCodingTask.mockResolvedValue({
      id: taskId,
      threadId,
      tenantId,
      ownerUserId,
      codingContext: JSON.stringify({
        source: 'zip', artifactId: 'artifact-1', instruction: '检查项目', role: 'qa', task: 'verify',
      }),
      verification: JSON.stringify({ logsArtifactId: 'logs-1' }),
    });
    artifacts.getOwned.mockResolvedValue({
      id: 'logs-1',
      status: 'ready',
      threadId,
      tenantId,
      metadata: JSON.stringify({ studio: 'qa', target: 'qa-logs', role: 'qa', taskType: 'verify', taskId }),
    });
    artifacts.getFileOwned.mockResolvedValue(file);

    await expect(
      service.getLogsFile({ taskId, threadId, ownerUserId, tenantId }),
    ).resolves.toBe(file);
    expect(artifacts.getFileOwned).toHaveBeenCalledWith('logs-1', ownerUserId);
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
        parentRunId: 'parent-run',
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
        parentRunId: 'parent-run',
      }),
    };
    tasks.findById
      .mockResolvedValueOnce(workerTask)
      .mockResolvedValueOnce({ ...workerTask, status: 'running' })
      .mockResolvedValueOnce({ ...workerTask, status: 'running' })
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
      diff: {
        added: [{ path: 'src/main.ts', sha256: 'hash' }],
        modified: [],
        deleted: [],
      },
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
      {
        runId,
        taskId,
        resume: false,
        role: 'frontend',
        strictRole: false,
      },
    );
    expect(workspace.exportWorkspace).toHaveBeenCalledWith(
      threadId,
      ownerUserId,
      tenantId,
      expect.objectContaining({
        taskId,
        role: 'frontend',
        parentRunId: 'parent-run',
        traceId: runId,
      }),
    );
    expect(tasks.updateCodingTask).toHaveBeenLastCalledWith(
      taskId,
      expect.objectContaining({
        status: 'waiting_review',
        outputArtifactId: 'coding-output-artifact',
      }),
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
      .mockResolvedValueOnce({ ...workerTask, status: 'running' })
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
      .mockResolvedValueOnce({ ...workerTask, status: 'running' })
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

  it('rejects unsupported role and task combinations before creating a run', async () => {
    const { service, runs, workspace } = createService();

    await expect(
      service.submit({
        threadId,
        ownerUserId,
        tenantId,
        body: { ...body, role: 'qa', task: 'code' },
      }),
    ).rejects.toThrow('岗位与任务类型组合无效');

    expect(workspace.validateCodingArtifact).not.toHaveBeenCalled();
    expect(runs.start).not.toHaveBeenCalled();
  });

  it('stores the role-specific QA task and parent workflow run', async () => {
    const { service, tasks, runs } = createService();

    const accepted = await service.submit({
      threadId,
      ownerUserId,
      tenantId,
      body: { ...body, role: 'qa', task: 'verify' },
    });

    expect(accepted.status).toBe('queued');
    expect(runs.start).toHaveBeenCalledWith(
      expect.objectContaining({ maxSteps: 6, maxToolCalls: 4 }),
      expect.anything(),
    );
    expect(tasks.createCodingTask).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'qa',
        task: 'verify',
        strictRole: true,
        parentRunId: 'parent-run',
      }),
      expect.anything(),
    );
  });

  it('runs QA through the bounded test agent and saves a human review report artifact', async () => {
    const { service, tasks, runs, queue, testAgent, artifacts } = createService();
    const qaReport = {
      artifactId: 'artifact-1',
      artifactVersion: '2',
      applicableChecks: ['lint', 'test', 'build'],
      requiredChecks: ['lint', 'test', 'build'],
      skippedChecks: [],
      checks: [
        {
          name: 'lint',
          status: 'passed',
          exitCode: 0,
          summary: 'lint output preview',
          outputTruncated: true,
          logPreview: 'lint output preview',
          logRef: null,
        },
        {
          name: 'test',
          status: 'passed',
          exitCode: 0,
          summary: '1 suite passed',
          outputTruncated: false,
          logPreview: null,
          logRef: null,
        },
        {
          name: 'build',
          status: 'passed',
          exitCode: 0,
          summary: 'build passed',
          outputTruncated: false,
          logPreview: null,
          logRef: null,
        },
      ],
      diagnosis: '测试通过',
      evidenceRefs: [],
      suggestedFixes: [],
      requiresHumanReview: true,
      status: 'passed',
      summary: '检查通过',
      parentRunId: 'parent-run',
      traceId: runId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const workerTask = {
      id: taskId,
      runId,
      threadId,
      tenantId,
      ownerUserId,
      requestId,
      taskType: 'coding_task',
      status: 'queued',
      retryCount: 0,
      codingContext: JSON.stringify({
        source: 'zip',
        artifactId: 'artifact-1',
        instruction: '验证项目',
        role: 'qa',
        task: 'verify',
        strictRole: true,
        parentRunId: 'parent-run',
      }),
    };
    tasks.findById
      .mockResolvedValueOnce(workerTask)
      .mockResolvedValueOnce({ ...workerTask, status: 'running' })
      .mockResolvedValueOnce({ ...workerTask, status: 'running' });
    tasks.updateCodingTask
      .mockResolvedValueOnce({ ...workerTask, status: 'running' })
      .mockResolvedValueOnce({ ...workerTask, status: 'waiting_review' });
    testAgent.runWithExecutionOptions.mockResolvedValue({
      status: 'completed',
      summary: '检查通过',
      toolCalls: 1,
      report: qaReport,
      logs: {
        lint: { status: 'passed', command: 'npm run lint', exitCode: 0, output: 'lint output', outputTruncated: true },
        test: { status: 'passed', command: 'npm test', exitCode: 0, output: 'test output' },
        build: { status: 'passed', command: 'npm run build', exitCode: 0, output: 'build output' },
      },
    });
    runs.finish.mockResolvedValue({ id: runId, status: 'completed' });

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

    expect(testAgent.runWithExecutionOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: 'artifact-1',
        parentRunId: 'parent-run',
        resume: false,
      }),
    );
    expect(artifacts.createStudioVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          studio: 'qa',
          target: 'qa-report',
          taskId,
          traceId: runId,
        }),
      }),
    );
    expect(artifacts.createStudioVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ target: 'qa-logs', taskId }),
      }),
    );
    const reportArtifactCall = artifacts.createStudioVersion.mock.calls.find(
      ([input]) => input.metadata.target === 'qa-report',
    );
    expect(reportArtifactCall?.[0].sourceText).toContain('qa-logs-artifact#test');
    expect(reportArtifactCall?.[0].sourceText).toContain('"logRef": null');
    expect(reportArtifactCall?.[0].sourceText).toContain('"outputTruncated": true');
    expect(reportArtifactCall?.[0].sourceText).toContain('"logPreview": "lint output preview"');
    expect(tasks.updateCodingTask).toHaveBeenLastCalledWith(
      taskId,
      expect.objectContaining({
        status: 'waiting_review',
        outputArtifactId: 'qa-report-artifact',
      }),
    );
  });

  it('requires reconciliation when a QA tool result has an unknown side effect', async () => {
    const { service, tasks, runs, runtimeEvents, queue, testAgent } = createService();
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
        instruction: '检查项目',
        role: 'qa',
        task: 'verify',
        strictRole: true,
      }),
    };
    tasks.findById
      .mockResolvedValueOnce(workerTask)
      .mockResolvedValueOnce({ ...workerTask, status: 'running' })
      .mockResolvedValueOnce({ ...workerTask, status: 'running' });
    tasks.updateCodingTask
      .mockResolvedValueOnce({ ...workerTask, status: 'running' })
      .mockResolvedValueOnce({ ...workerTask, status: 'waiting_reconciliation' });
    runtimeEvents.list.mockResolvedValue([{ eventType: 'tool.unknown' }]);
    testAgent.runWithExecutionOptions.mockResolvedValue({
      status: 'blocked',
      summary: 'QA 工具结果未知',
      toolCalls: 1,
      report: null,
    });
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
    expect(tasks.ensureCodingTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'waiting_reconciliation' }),
      'task.reconciliation_required',
      expect.any(Object),
      expect.any(String),
    );
  });

  it('records an owner scoped QA review with an idempotent audit event', async () => {
    const { service, tasks } = createService();
    const qaTask = {
      id: taskId,
      runId,
      threadId,
      tenantId,
      ownerUserId,
      taskType: 'coding_task',
      status: 'waiting_review',
      outputArtifactId: 'qa-report-artifact',
      codingContext: JSON.stringify({
        source: 'zip',
        artifactId: 'artifact-1',
        instruction: '检查项目',
        role: 'qa',
        task: 'verify',
      }),
      verification: JSON.stringify({ status: 'incomplete', requiresHumanReview: true }),
    };
    tasks.findOwnedCodingTask.mockResolvedValue(qaTask);
    tasks.transitionCodingTask.mockImplementation(async (_id, _status, patch) => ({
      ...qaTask,
      status: patch.status,
      verification: patch.verification,
    }));

    const result = await service.review({
      taskId,
      threadId,
      ownerUserId,
      tenantId,
      body: {
        reviewId: requestId,
        decision: 'rejected',
        comment: '补齐测试并重新运行 QA',
      },
    });

    expect(result).toMatchObject({ taskId, status: 'rejected' });
    expect(result.review).toMatchObject({
      reviewId: requestId,
      reviewerUserId: ownerUserId,
      decision: 'rejected',
      comment: '补齐测试并重新运行 QA',
      artifactId: 'artifact-1',
      remediationArtifactId: 'artifact-1',
    });
    expect(tasks.transitionCodingTask).toHaveBeenCalledWith(
      taskId,
      'waiting_review',
      expect.objectContaining({ status: 'rejected' }),
    );
    expect(tasks.ensureCodingTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected' }),
      'task.qa_rejected',
      expect.objectContaining({ status: 'rejected' }),
      `qa-review:${taskId}:${requestId}`,
      ownerUserId,
    );

    tasks.findOwnedCodingTask.mockResolvedValue({
      ...qaTask,
      status: 'rejected',
      verification: JSON.stringify({
        status: 'incomplete',
        requiresHumanReview: true,
        review: result.review,
      }),
    });
    await expect(
      service.review({
        taskId,
        threadId,
        ownerUserId,
        tenantId,
        body: {
          reviewId: requestId,
          decision: 'rejected',
          comment: '补齐测试并重新运行 QA',
        },
      }),
    ).resolves.toMatchObject({ status: 'rejected', review: result.review });
    expect(tasks.transitionCodingTask).toHaveBeenCalledTimes(1);
    expect(tasks.ensureCodingTaskEvent).toHaveBeenCalledTimes(2);
  });

  it('rejects QA reviews without a rejection comment', async () => {
    const { service, tasks } = createService();
    tasks.findOwnedCodingTask.mockResolvedValue({
      id: taskId,
      runId,
      threadId,
      tenantId,
      ownerUserId,
      taskType: 'coding_task',
      status: 'waiting_review',
      codingContext: JSON.stringify({
        source: 'zip', artifactId: 'artifact-1', instruction: '检查项目', role: 'qa', task: 'verify',
      }),
      verification: JSON.stringify({ status: 'passed' }),
    });

    await expect(
      service.review({
        taskId,
        threadId,
        ownerUserId,
        tenantId,
        body: { reviewId: requestId, decision: 'rejected' },
      }),
    ).rejects.toThrow('A rejection comment is required');
    expect(tasks.transitionCodingTask).not.toHaveBeenCalled();
  });
});
