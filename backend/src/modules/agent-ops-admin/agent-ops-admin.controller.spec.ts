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
});
