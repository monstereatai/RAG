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
      save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation((_where, values) => {
        Object.assign(run, values);
        return Promise.resolve({ affected: 1 });
      }),
    };
    const events = {
      emit: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
      metrics: jest.fn().mockResolvedValue({}),
    };
    const redis = {
      isEnabled: jest.fn().mockReturnValue(true),
      setRequiredOrThrow: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AgentRunsService(
      repo as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      events as never,
      { get: jest.fn() } as never,
      {
        analyzeFailureOnset: jest.fn().mockReturnValue({ found: false }),
      } as never,
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
    expect(redis.setRequiredOrThrow).toHaveBeenCalledWith(
      'agent-loop:cancel:thread-1:run-1',
      'cancelled',
      86_400,
    );
    expect(events.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'run.cancelled' }),
    );
  });

  it('rejects resuming a run after cancellation won the state transition', async () => {
    const { service, repo, run } = createService();
    run.status = 'cancelled';
    repo.update.mockResolvedValueOnce({ affected: 0 });

    await expect(service.beginResume('run-1')).rejects.toThrow(
      '当前运行已被恢复或取消',
    );
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'run-1', status: 'waiting_approval' },
      { status: 'running' },
    );
  });

  it('signals the live agent loop after a stale run is marked failed', async () => {
    const { service, repo, events, redis, run } = createService();
    const staleRun = {
      ...run,
      updatedAt: new Date(Date.now() - 31 * 60_000),
    };
    repo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([staleRun]);

    await (
      service as unknown as { recoverStaleRuns: () => Promise<void> }
    ).recoverStaleRuns();

    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'run-1', status: 'running' }),
      expect.objectContaining({ status: 'failed' }),
    );
    expect(redis.setRequiredOrThrow).toHaveBeenCalledWith(
      'agent-loop:cancel:thread-1:run-1',
      'cancelled',
      86_400,
    );
    expect(events.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        eventType: 'run.failed',
      }),
    );
  });

  it('compares stale timestamps using UTC values for PostgreSQL', async () => {
    const { service, repo } = createService();
    const now = jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse('2026-11-04T06:00:00.000Z'));
    try {
      await (
        service as unknown as { recoverStaleRuns: () => Promise<void> }
      ).recoverStaleRuns();
      const findCalls = repo.find.mock.calls as unknown as Array<
        [
          {
            where: {
              updatedAt: { objectLiteralParameters: Record<string, unknown> };
            };
          },
        ]
      >;
      const staleScan = findCalls[1]?.[0];
      expect(staleScan.where.updatedAt.objectLiteralParameters).toEqual({
        staleCutoffUtc: '2026-11-04 05:30:00.000',
      });
    } finally {
      now.mockRestore();
    }
  });

  it('does not signal cancellation when another transition wins stale-run CAS', async () => {
    const { service, repo, events, redis, run } = createService();
    const staleRun = {
      ...run,
      updatedAt: new Date(Date.now() - 31 * 60_000),
    };
    repo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([staleRun]);
    repo.update.mockResolvedValueOnce({ affected: 0 });

    await (
      service as unknown as { recoverStaleRuns: () => Promise<void> }
    ).recoverStaleRuns();

    expect(redis.setRequiredOrThrow).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('retries a stale-run cancellation signal on the next recovery scan', async () => {
    const { service, repo, events, redis, run } = createService();
    const staleRun = {
      ...run,
      updatedAt: new Date(Date.now() - 31 * 60_000),
    };
    repo.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([staleRun])
      .mockResolvedValueOnce([run]);
    redis.setRequiredOrThrow.mockRejectedValueOnce(
      new Error('Redis temporarily unavailable'),
    );

    await (
      service as unknown as { recoverStaleRuns: () => Promise<void> }
    ).recoverStaleRuns();
    await (
      service as unknown as { recoverStaleRuns: () => Promise<void> }
    ).recoverStaleRuns();

    expect(redis.setRequiredOrThrow).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledTimes(1);
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
    expect(redis.setRequiredOrThrow).toHaveBeenCalled();
  });
});
