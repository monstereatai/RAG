import { AgentLoopService } from './agent-loop.service';

describe('AgentLoopService', () => {
  const events = { emit: jest.fn().mockResolvedValue(undefined) };
  const redis = {
    set: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    isEnabled: jest.fn().mockReturnValue(true),
  };
  const tools = {
    execute: jest.fn(async (input: { execute: () => Promise<unknown> }) => ({
      callId: 'call-1',
      status: 'success',
      output: await input.execute(),
      durationMs: 1,
    })),
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
            execute: async () => 'answer',
            reduce: (current: State, draft: string) => ({ ...current, draft }),
          };
        if (!state.valid)
          return {
            type: 'tool',
            name: 'citation_validate',
            mode: 'agentic',
            execute: async () => true,
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
        execute: async () => true,
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
      timeoutMs: 1_000,
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
    ).rejects.toThrow('身份或运行标识不匹配');
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
});
