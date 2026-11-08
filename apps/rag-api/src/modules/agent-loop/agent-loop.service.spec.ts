import { AgentLoopService } from './agent-loop.service';

describe('AgentLoopService', () => {
  const events = { emit: jest.fn().mockResolvedValue(undefined) };
  const redis = {
    set: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    isEnabled: jest.fn().mockReturnValue(true),
  };
  const tools = {
    execute: jest.fn(async (input: { execute: () => Promise<unknown> }) => {
      const output = await input.execute();
      return {
        callId: 'call-1',
        status: 'success',
        output,
        contextOutput: output,
        durationMs: 1,
      };
    }),
  };

  beforeEach(() => jest.clearAllMocks());

  it('runs model and tool actions before completing', async () => {
    const service = new AgentLoopService(
      tools as never,
      events as never,
      redis as never,
    );
    type State = { draft?: string; valid?: boolean };
    const result = await service.run<State, string>({
      threadId: 'thread-1',
      runId: 'run-1',
      actor: 'test-agent',
      initialState: {},
      maxSteps: 3,
      maxToolCalls: 1,
      timeoutMs: 1_000,
      decide: (state) => {
        if (!state.draft)
          return {
            type: 'model',
            name: 'draft',
            execute: () => Promise.resolve('answer'),
            reduce: (current: State, draft: string) => ({ ...current, draft }),
          };
        if (!state.valid)
          return {
            type: 'tool',
            name: 'citation_validate',
            mode: 'agentic',
            execute: () => Promise.resolve(true),
            reduce: (current: State, valid: boolean) => ({ ...current, valid }),
          };
        return { type: 'complete', output: state.draft, reason: 'validated' };
      },
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('answer');
    expect(result.steps).toBe(3);
    expect(result.toolCalls).toBe(1);
    expect(redis.set).toHaveBeenCalledTimes(2);
  });

  it('stops before exceeding the tool budget', async () => {
    const service = new AgentLoopService(
      tools as never,
      events as never,
      redis as never,
    );
    const result = await service.run<{ calls: number }, string>({
      threadId: 'thread-2',
      actor: 'test-agent',
      initialState: { calls: 0 },
      maxSteps: 3,
      maxToolCalls: 0,
      timeoutMs: 1_000,
      decide: (state) => ({
        type: 'tool',
        name: 'citation_validate',
        mode: 'agentic',
        execute: () => Promise.resolve(true),
        reduce: () => ({ calls: state.calls + 1 }),
      }),
    });

    expect(result.status).toBe('budget_exceeded');
    expect(tools.execute).not.toHaveBeenCalled();
  });

  it('resumes from the next step while preserving consumed tool budget', async () => {
    const service = new AgentLoopService(
      tools as never,
      events as never,
      redis as never,
    );
    redis.get.mockResolvedValue(
      JSON.stringify({
        version: 1,
        threadId: 'thread-resume',
        actor: 'test-agent',
        runId: 'run-1',
        step: 1,
        toolCalls: 1,
        elapsedMs: 1_500,
        state: { draft: 'already-generated' },
        updatedAt: new Date().toISOString(),
      }),
    );

    const decide = jest.fn(
      (
        state: { draft: string },
        context: { step: number; toolCalls: number },
      ) => {
        expect(context).toEqual(
          expect.objectContaining({ step: 2, toolCalls: 1 }),
        );
        return {
          type: 'complete' as const,
          output: state.draft,
          reason: 'resumed',
        };
      },
    );
    const result = await service.resume<{ draft: string }, string>({
      threadId: 'thread-resume',
      runId: 'run-1',
      actor: 'test-agent',
      initialState: { draft: '' },
      maxSteps: 3,
      maxToolCalls: 1,
      timeoutMs: 2_000,
      decide,
    });

    expect(result).toMatchObject({
      status: 'completed',
      output: 'already-generated',
      steps: 2,
      toolCalls: 1,
    });
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('does not restore a checkpoint with a fresh timeout budget', async () => {
    const service = new AgentLoopService(
      tools as never,
      events as never,
      redis as never,
    );
    redis.get.mockResolvedValue(
      JSON.stringify({
        version: 1,
        threadId: 'thread-timeout',
        actor: 'test-agent',
        runId: 'run-1',
        step: 1,
        toolCalls: 0,
        elapsedMs: 2_000,
        state: {},
        updatedAt: new Date().toISOString(),
      }),
    );

    await expect(
      service.resume({
        threadId: 'thread-timeout',
        runId: 'run-1',
        actor: 'test-agent',
        initialState: {},
        maxSteps: 3,
        maxToolCalls: 0,
        timeoutMs: 1_000,
        decide: jest.fn(),
      }),
    ).rejects.toMatchObject({ code: 'budget_exceeded' });
  });

  it('enforces the total timeout while the decision function is running', async () => {
    const service = new AgentLoopService(
      tools as never,
      events as never,
      redis as never,
    );

    const result = await service.run({
      threadId: 'decision-timeout',
      actor: 'test-agent',
      initialState: {},
      maxSteps: 1,
      maxToolCalls: 0,
      timeoutMs: 10,
      decide: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { type: 'complete' as const, output: 'late', reason: 'late' };
      },
    });

    expect(result.status).toBe('failed');
    expect(result.terminationReason).toContain('timeout');
  });

  it('aborts an active action when the run is cancelled', async () => {
    const service = new AgentLoopService(
      tools as never,
      events as never,
      redis as never,
    );
    let actionAborted = false;
    redis.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue('cancelled');

    const result = await service.run({
      threadId: 'active-cancel',
      runId: 'run-1',
      actor: 'test-agent',
      initialState: {},
      maxSteps: 1,
      maxToolCalls: 0,
      timeoutMs: 2_000,
      decide: () => ({
        type: 'model' as const,
        name: 'slow-model',
        execute: (signal) =>
          new Promise<string>((resolve) => {
            signal?.addEventListener('abort', () => {
              actionAborted = true;
              resolve('cancelled');
            });
          }),
        reduce: (state: object) => state,
      }),
    });

    expect(result.status).toBe('cancelled');
    expect(actionAborted).toBe(true);
  });

  it('rejects a checkpoint from another run', async () => {
    const service = new AgentLoopService(
      tools as never,
      events as never,
      redis as never,
    );
    redis.get.mockResolvedValue(
      JSON.stringify({
        version: 1,
        threadId: 'thread-1',
        actor: 'test-agent',
        runId: 'old-run',
        step: 1,
        toolCalls: 0,
        state: {},
        updatedAt: '',
      }),
    );
    await expect(
      service.resume({
        threadId: 'thread-1',
        runId: 'new-run',
        actor: 'test-agent',
        initialState: {},
        maxSteps: 2,
        maxToolCalls: 0,
        timeoutMs: 1_000,
        decide: () => ({ type: 'blocked', reason: 'should not run' }),
      }),
    ).rejects.toThrow('身份、计数或运行标识不匹配');
  });

  it('isolates checkpoints for concurrent runs in the same thread', () => {
    const service = new AgentLoopService(
      tools as never,
      events as never,
      redis as never,
    );
    const internals = service as unknown as {
      checkpointKey: (
        threadId: string,
        actor: string,
        runId?: string,
      ) => string;
    };

    expect(
      internals.checkpointKey.call(service, 'thread-1', 'agent', 'run-1'),
    ).not.toBe(
      internals.checkpointKey.call(service, 'thread-1', 'agent', 'run-2'),
    );
  });

  it('stops before the next round when the run is cancelled', async () => {
    const service = new AgentLoopService(
      tools as never,
      events as never,
      redis as never,
    );
    redis.get.mockResolvedValue('cancelled');
    const decide = jest.fn();

    const result = await service.run({
      threadId: 'cancelled-thread',
      runId: 'cancelled-run',
      actor: 'test-agent',
      initialState: {},
      maxSteps: 3,
      maxToolCalls: 1,
      timeoutMs: 1_000,
      decide,
    });

    expect(result).toMatchObject({
      status: 'cancelled',
      steps: 0,
      toolCalls: 0,
    });
    expect(decide).not.toHaveBeenCalled();
  });

  it('persists task identity in checkpoints and runtime events', async () => {
    redis.get.mockResolvedValue(null);
    const service = new AgentLoopService(
      tools as never,
      events as never,
      redis as never,
    );
    const result = await service.run({
      threadId: 'thread-coding',
      runId: 'run-coding',
      taskId: 'task-coding',
      actor: 'test-agent',
      initialState: { finished: false },
      maxSteps: 2,
      maxToolCalls: 0,
      timeoutMs: 1_000,
      decide: (state: { finished: boolean }) =>
        state.finished
          ? { type: 'complete' as const, output: 'ok', reason: 'done' }
          : {
              type: 'model' as const,
              name: 'mark-finished',
              execute: () => Promise.resolve(true),
              reduce: () => ({ finished: true }),
            },
    });

    expect(result.status).toBe('completed');
    expect(JSON.parse(redis.set.mock.calls[0][1])).toMatchObject({
      runId: 'run-coding',
      taskId: 'task-coding',
    });
    expect(events.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-coding',
        taskId: 'task-coding',
        eventType: 'agent.loop.started',
      }),
    );
  });

  it('rejects a checkpoint when task identity or checkpoint age is invalid', async () => {
    const service = new AgentLoopService(
      tools as never,
      events as never,
      redis as never,
    );
    const base = {
      threadId: 'thread-coding',
      runId: 'run-coding',
      taskId: 'task-coding',
      actor: 'test-agent',
      initialState: {},
      maxSteps: 3,
      maxToolCalls: 1,
      timeoutMs: 10_000,
      checkpointTtlSeconds: 3_600,
      decide: () => ({ type: 'blocked' as const, reason: 'unused' }),
    };
    redis.get.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        threadId: base.threadId,
        actor: base.actor,
        runId: base.runId,
        taskId: 'another-task',
        step: 1,
        toolCalls: 0,
        elapsedMs: 0,
        state: {},
        updatedAt: new Date().toISOString(),
      }),
    );
    await expect(service.assertCanResume(base)).rejects.toMatchObject({
      code: 'identity_mismatch',
    });

    redis.get.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        threadId: base.threadId,
        actor: base.actor,
        runId: base.runId,
        taskId: base.taskId,
        step: 1,
        toolCalls: 0,
        elapsedMs: 0,
        state: {},
        updatedAt: new Date(Date.now() - 7_200_000).toISOString(),
      }),
    );
    await expect(service.assertCanResume(base)).rejects.toMatchObject({
      code: 'checkpoint_expired',
    });
  });

  it('rejects manual resume after the checkpoint consumed its time budget', async () => {
    const service = new AgentLoopService(
      tools as never,
      events as never,
      redis as never,
    );
    redis.get.mockResolvedValue(
      JSON.stringify({
        version: 1,
        threadId: 'thread-budget',
        actor: 'test-agent',
        runId: 'run-budget',
        taskId: 'task-budget',
        step: 1,
        toolCalls: 0,
        elapsedMs: 1_000,
        state: {},
        updatedAt: new Date().toISOString(),
      }),
    );

    await expect(
      service.assertCanResume({
        threadId: 'thread-budget',
        runId: 'run-budget',
        taskId: 'task-budget',
        actor: 'test-agent',
        initialState: {},
        maxSteps: 3,
        maxToolCalls: 1,
        timeoutMs: 1_000,
        decide: () => ({ type: 'blocked', reason: 'unused' }),
      }),
    ).rejects.toMatchObject({ code: 'budget_exceeded' });
  });
});
