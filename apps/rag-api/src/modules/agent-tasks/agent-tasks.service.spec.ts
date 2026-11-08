import { AgentTasksService } from './agent-tasks.service';

describe('AgentTasksService retry execution handoff', () => {
  it('only retries failed tasks and dispatches the real workflow handler', async () => {
    const task = {
      id: 'task-1',
      threadId: 'thread-1',
      role: 'frontend',
      status: 'failed',
      retryCount: 0,
      errorMessage: '模型超时',
    };
    const handler = jest.fn().mockResolvedValue(undefined);
    const repo = {
      findOne: jest.fn().mockResolvedValue(task),
      save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
    };
    const events = { emit: jest.fn().mockResolvedValue(undefined) };
    const service = new AgentTasksService(repo as never, events as never);
    service.registerRetryHandler(handler);

    const result = await service.retry('task-1');
    await new Promise((resolve) => setImmediate(resolve));

    expect(result).toMatchObject({ status: 'pending', retryCount: 1 });
    expect(handler).toHaveBeenCalledWith(result);
    expect(events.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'task.retry' }),
    );
  });

  it('does not claim waiting approval is a runnable task retry', async () => {
    const repo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'task-1',
        threadId: 'thread-1',
        role: 'frontend',
        status: 'waiting_approval',
        retryCount: 0,
      }),
    };
    const service = new AgentTasksService(
      repo as never,
      { emit: jest.fn() } as never,
    );

    await expect(service.retry('task-1')).rejects.toThrow(
      'not retryable from waiting_approval',
    );
  });

  it('routes coding tasks away from the legacy retry handler', async () => {
    const task = {
      id: 'task-1',
      threadId: 'thread-1',
      taskType: 'coding_task',
      status: 'failed',
      retryCount: 0,
    };
    const retryHandler = jest.fn();
    const service = new AgentTasksService(
      { findOne: jest.fn().mockResolvedValue(task) } as never,
      { emit: jest.fn() } as never,
    );
    service.registerRetryHandler(retryHandler);

    await expect(service.retry('task-1')).rejects.toThrow(
      'Coding tasks must use the Coding Task resume endpoint.',
    );
    expect(retryHandler).not.toHaveBeenCalled();
  });

  it('creates coding tasks through the caller transaction manager', async () => {
    const taskRepository = {
      create: jest.fn((value) => value),
      save: jest.fn((value) => Promise.resolve(value)),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(taskRepository),
    };
    const service = new AgentTasksService({} as never, {} as never);

    const task = await service.createCodingTask(
      {
        id: 'task-1',
        threadId: 'thread-1',
        runId: 'run-1',
        tenantId: 'tenant-1',
        ownerUserId: 'owner-1',
        requestId: 'request-1',
        requestHash: 'hash-1',
        artifactId: 'artifact-1',
        instruction: '修复 lint',
      },
      manager as never,
    );

    expect(manager.getRepository).toHaveBeenCalled();
    expect(taskRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-1',
        taskType: 'coding_task',
        ownerUserId: 'owner-1',
        runId: 'run-1',
      }),
    );
    expect(task).toMatchObject({ status: 'queued', retryCount: 0 });
  });

  it('scopes task reads by owner, tenant, and thread', async () => {
    const repository = { findOne: jest.fn().mockResolvedValue({ id: 'task-1' }) };
    const service = new AgentTasksService(repository as never, {} as never);

    await service.findOwnedCodingTask('task-1', 'owner-1', 'tenant-1', 'thread-1');

    expect(repository.findOne).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        taskType: 'coding_task',
        ownerUserId: 'owner-1',
        tenantId: 'tenant-1',
        threadId: 'thread-1',
      },
    });
  });
});
