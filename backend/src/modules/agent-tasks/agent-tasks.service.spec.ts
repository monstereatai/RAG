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
});
