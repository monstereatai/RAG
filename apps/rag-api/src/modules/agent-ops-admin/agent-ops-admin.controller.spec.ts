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
