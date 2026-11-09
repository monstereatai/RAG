import { AgentOpsAdminController } from './agent-ops-admin.controller';

describe('AgentOpsAdminController task owner isolation', () => {
  const workflows = {
    list: jest.fn(),
    assertOwnedThread: jest.fn(),
  };
  const tasks = {
    list: jest.fn(),
    findById: jest.fn(),
    retry: jest.fn(),
    delegate: jest.fn(),
  };
  const runs = { reserveDelegation: jest.fn() };
  const projectWorkspace = {
    getStatus: jest.fn(),
    startWorkspace: jest.fn(),
    runCommand: jest.fn(),
    startDevServer: jest.fn(),
    stopDevServer: jest.fn(),
    issuePreviewTicket: jest.fn(),
    proxyPreview: jest.fn(),
    exportWorkspace: jest.fn(),
    destroyWorkspace: jest.fn(),
  };
  const projectWorkspaceAgent = { run: jest.fn() };
  const codingTasks = {
    submit: jest.fn(),
    get: jest.fn(),
    cancel: jest.fn(),
    resume: jest.fn(),
    getReportFile: jest.fn(),
    getLogsFile: jest.fn(),
    review: jest.fn(),
  };
  const controller = new AgentOpsAdminController(
    workflows as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    runs as never,
    {} as never,
    tasks as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    projectWorkspace as never,
    projectWorkspaceAgent as never,
    codingTasks as never,
  );

  beforeEach(() => jest.resetAllMocks());

  it('only lists tasks belonging to the requesting owner workflows', async () => {
    workflows.list.mockResolvedValue([{ threadId: 'thread-owner' }]);
    tasks.list.mockResolvedValue([
      { id: 'task-owner', threadId: 'thread-owner' },
      { id: 'task-other', threadId: 'thread-other' },
    ]);

    await expect(
      controller.listAgentTasks(undefined, 'owner-1'),
    ).resolves.toEqual([{ id: 'task-owner', threadId: 'thread-owner' }]);
  });

  it('validates ownership before retrying a task', async () => {
    tasks.findById.mockResolvedValue({ id: 'task-1', threadId: 'thread-1' });
    tasks.retry.mockResolvedValue({ id: 'task-1', status: 'pending' });

    await controller.retryAgentTask('task-1', 'owner-1');

    expect(workflows.assertOwnedThread).toHaveBeenCalledWith(
      'thread-1',
      'owner-1',
    );
    expect(tasks.retry).toHaveBeenCalledWith('task-1');
  });

  it('does not forward owner identity from a delegation request into task data', async () => {
    tasks.delegate.mockResolvedValue({ id: 'task-1' });

    await controller.delegateAgentTask({
      ownerUserId: 'owner-1',
      threadId: 'thread-1',
      role: 'frontend',
      title: '实现前端',
      description: '实现页面',
    });

    expect(workflows.assertOwnedThread).toHaveBeenCalledWith(
      'thread-1',
      'owner-1',
    );
    expect(tasks.delegate).toHaveBeenCalledWith({
      threadId: 'thread-1',
      role: 'frontend',
      title: '实现前端',
      description: '实现页面',
    });
  });

  it('scopes project workspace operations to the workflow owner and tenant', async () => {
    projectWorkspace.getStatus.mockResolvedValue({ ready: false });
    projectWorkspaceAgent.run.mockResolvedValue({ status: 'completed' });

    await expect(
      controller.productionProjectWorkspaceStatus(
        'thread-1',
        'owner-1',
        'tenant-1',
      ),
    ).resolves.toEqual({ ready: false });
    await controller.runProductionProjectWorkspaceAgent(
      'thread-1',
      'owner-1',
      'tenant-1',
      { artifactId: 'artifact-1', instruction: '运行测试' },
    );

    expect(projectWorkspace.getStatus).toHaveBeenCalledWith(
      'thread-1',
      'owner-1',
      'tenant-1',
    );
    expect(projectWorkspaceAgent.run).toHaveBeenCalledWith(
      'thread-1',
      'owner-1',
      'tenant-1',
      'artifact-1',
      '运行测试',
    );
  });

  it('passes an explicit role through workspace startup with strict workflow scope', async () => {
    projectWorkspace.startWorkspace.mockResolvedValue({ ready: true });

    await controller.startProductionProjectWorkspace(
      'thread-1',
      'owner-1',
      'tenant-1',
      { artifactId: 'nestjs-1', role: 'backend' },
    );

    expect(projectWorkspace.startWorkspace).toHaveBeenCalledWith(
      'thread-1',
      'owner-1',
      'tenant-1',
      'nestjs-1',
      'backend',
      'code',
      true,
    );
  });

  it('checks workflow ownership before accepting an async coding task', async () => {
    codingTasks.submit.mockResolvedValue({
      taskId: 'task-1',
      runId: 'run-1',
      status: 'queued',
    });

    await expect(
      controller.submitProductionProjectWorkspaceCodingTask(
        'thread-1',
        'owner-1',
        'tenant-1',
        {
          artifactId: 'artifact-1',
          instruction: '修复 lint',
          requestId: '00000000-0000-4000-8000-000000000001',
        },
      ),
    ).resolves.toEqual({ taskId: 'task-1', runId: 'run-1', status: 'queued' });

    expect(workflows.assertOwnedThread).toHaveBeenCalledWith(
      'thread-1',
      'owner-1',
    );
    expect(codingTasks.submit).toHaveBeenCalledWith({
      threadId: 'thread-1',
      ownerUserId: 'owner-1',
      tenantId: 'tenant-1',
      body: expect.objectContaining({ artifactId: 'artifact-1' }),
    });
  });

  it('passes task controls through the owner-scoped coding service', async () => {
    codingTasks.get.mockResolvedValue({ taskId: 'task-1', status: 'running' });
    codingTasks.cancel.mockResolvedValue({ taskId: 'task-1', status: 'cancelled' });

    await controller.productionProjectWorkspaceCodingTaskStatus(
      'thread-1', 'task-1', 'owner-1', 'tenant-1',
    );
    await controller.cancelProductionProjectWorkspaceCodingTask(
      'thread-1', 'task-1', 'owner-1', 'tenant-1', { reason: '停止' },
    );

    expect(codingTasks.get).toHaveBeenCalledWith({
      taskId: 'task-1', threadId: 'thread-1', ownerUserId: 'owner-1', tenantId: 'tenant-1',
    });
    expect(codingTasks.cancel).toHaveBeenCalledWith({
      taskId: 'task-1', threadId: 'thread-1', ownerUserId: 'owner-1', tenantId: 'tenant-1', reason: '停止',
    });
  });

  it('streams an owner-scoped QA report file', async () => {
    const body = Buffer.from('{"status":"passed"}');
    codingTasks.getReportFile.mockResolvedValue({
      artifact: { filename: 'qa report.json', contentType: 'application/json' },
      body,
    });
    const response = {
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };

    await controller.downloadWorkspaceCodingTaskReport(
      'thread-1',
      'task-1',
      'owner-1',
      'tenant-1',
      response as never,
    );

    expect(codingTasks.getReportFile).toHaveBeenCalledWith({
      taskId: 'task-1',
      threadId: 'thread-1',
      ownerUserId: 'owner-1',
      tenantId: 'tenant-1',
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.type).toHaveBeenCalledWith('application/json');
    expect(response.send).toHaveBeenCalledWith(body);
  });

  it('downloads scoped QA logs and forwards a review decision', async () => {
    const body = Buffer.from('{"checks":{}}');
    codingTasks.getLogsFile.mockResolvedValue({
      artifact: { filename: 'qa-logs.json', contentType: 'application/json' },
      body,
    });
    codingTasks.review.mockResolvedValue({ taskId: 'task-1', status: 'approved' });
    const response = {
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    const review = { reviewId: '11111111-1111-4111-8111-111111111111', decision: 'approved' as const };

    await controller.downloadWorkspaceCodingTaskLogs(
      'thread-1', 'task-1', 'owner-1', 'tenant-1', response as never,
    );
    await expect(
      controller.reviewWorkspaceCodingTask(
        'thread-1', 'task-1', 'owner-1', 'tenant-1', review,
      ),
    ).resolves.toEqual({ taskId: 'task-1', status: 'approved' });

    expect(codingTasks.getLogsFile).toHaveBeenCalledWith({
      taskId: 'task-1', threadId: 'thread-1', ownerUserId: 'owner-1', tenantId: 'tenant-1',
    });
    expect(codingTasks.review).toHaveBeenCalledWith({
      taskId: 'task-1', threadId: 'thread-1', ownerUserId: 'owner-1', tenantId: 'tenant-1', body: review,
    });
    expect(response.send).toHaveBeenCalledWith(body);
  });

  it('requires the explicit discard flag when destroying a project workspace', async () => {
    projectWorkspace.destroyWorkspace.mockResolvedValue({ destroyed: true });

    await controller.destroyProductionProjectWorkspace(
      'thread-1',
      'owner-1',
      'tenant-1',
      { confirmDiscard: true },
    );

    expect(projectWorkspace.destroyWorkspace).toHaveBeenCalledWith(
      'thread-1',
      'owner-1',
      'tenant-1',
      true,
    );
  });
});
