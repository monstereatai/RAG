import { AgentLoopService } from './agent-loop.service';

describe('AgentLoopService', () => {
  const events = { emit: jest.fn().mockResolvedValue(undefined) };
  const redis = {
    set: jest.fn().mockResolvedValue(undefined),
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
    const service = new AgentLoopService(tools as never, events as never, redis as never);
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
        if (!state.draft) return {
          type: 'model', name: 'draft', execute: async () => 'answer',
          reduce: (current: State, draft: string) => ({ ...current, draft }),
        };
        if (!state.valid) return {
          type: 'tool', name: 'citation_validate', mode: 'agentic', execute: async () => true,
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
    const service = new AgentLoopService(tools as never, events as never, redis as never);
    const result = await service.run<{ calls: number }, string>({
      threadId: 'thread-2',
      actor: 'test-agent',
      initialState: { calls: 0 },
      maxSteps: 3,
      maxToolCalls: 0,
      timeoutMs: 1_000,
      decide: (state) => ({
        type: 'tool', name: 'citation_validate', mode: 'agentic', execute: async () => true,
        reduce: () => ({ calls: state.calls + 1 }),
      }),
    });

    expect(result.status).toBe('budget_exceeded');
    expect(tools.execute).not.toHaveBeenCalled();
  });
});
