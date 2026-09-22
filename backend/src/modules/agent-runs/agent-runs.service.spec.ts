import { BadRequestException } from '@nestjs/common';
import { AgentRunsService } from './agent-runs.service';

describe('AgentRunsService runtime controls', () => {
  const createService = () => {
    const run = {
      id: 'run-1',
      threadId: 'thread-1',
      userId: 'user-1',
      mode: 'agentic',
      status: 'running',
      retryCount: 0,
      cancelledAt: null,
      cancelReason: null,
      finishedAt: null,
    };
    const repo = {
      findOne: jest.fn().mockResolvedValue(run),
      save: jest.fn().mockImplementation(async (value) => value),
      update: jest.fn().mockImplementation(async (_where, values) => {
        Object.assign(run, values);
        return { affected: 1 };
      }),
    };
    const events = {
      emit: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
      metrics: jest.fn().mockResolvedValue({}),
    };
    const redis = {
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AgentRunsService(
      repo as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      events as never,
      { get: jest.fn() } as never,
      { analyzeFailureOnset: jest.fn().mockReturnValue({ found: false }) } as never,
      redis as never,
    );
    return { service, repo, events, redis, run };
  };

  it('cancels an active run idempotently and writes an audit event', async () => {
    const { service, repo, events, redis } = createService();
    const result = await service.cancel('run-1', '人工停止');

    expect(result).toMatchObject({ status: 'cancelled' });
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'run-1' }),
      expect.objectContaining({
        status: 'cancelled',
        cancelReason: '人工停止',
      }),
    );
    expect(redis.set).toHaveBeenCalledWith(
      'agent-loop:cancel:thread-1:run-1',
      'cancelled',
      86_400,
    );
    expect(events.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'run.cancelled' }),
    );
  });

  it('rejects retrying a non-terminal run', async () => {
    const { service } = createService();
    await expect(service.retry('run-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('does not overwrite a cancelled run during a late completion', async () => {
    const { service, repo, run } = createService();
    run.status = 'cancelled';

    const result = await service.finish('run-1', {
      status: 'completed',
      resultSummary: '不应覆盖取消状态',
    });

    expect(result).toMatchObject(run);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('does not complete a run when cancellation won the state transition race', async () => {
    const { service, repo, run } = createService();
    run.status = 'running';
    repo.update.mockResolvedValueOnce({ affected: 0 });
    repo.findOne.mockResolvedValue(run);

    const result = await service.finish('run-1', {
      status: 'completed',
      resultSummary: '迟到完成',
    });

    expect(result).toMatchObject(run);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('cancels only the active run owned by the requested user and thread', async () => {
    const { service, repo, redis } = createService();

    const result = await service.cancelActiveForThread('thread-1', 'user-1');

    expect(result).toMatchObject({ status: 'cancelled' });
    expect(repo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          { threadId: 'thread-1', userId: 'user-1', status: 'running' },
          {
            threadId: 'thread-1',
            userId: 'user-1',
            status: 'waiting_approval',
          },
        ],
      }),
    );
    expect(redis.set).toHaveBeenCalled();
  });
});
