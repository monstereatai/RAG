import { BadRequestException } from '@nestjs/common';
import { AgentRunsService } from './agent-runs.service';

describe('AgentRunsService runtime controls', () => {
  const createService = () => {
    const run = {
      id: 'run-1',
      threadId: 'thread-1',
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
      update: jest.fn().mockResolvedValue(undefined),
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
    expect(repo.save).toHaveBeenCalledWith(
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

    expect(result).toBe(run);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
