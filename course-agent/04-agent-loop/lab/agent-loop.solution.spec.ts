/**
 * Lab 04 · 参考答案自检
 *
 * 与学员版验收测试（agent-loop.student.spec.ts）逐字一致，仅 import 指向参考答案——
 * 保证验收口径统一：答案版必须 3 个全绿。
 */
import {
  runControlledLoop,
  type AgentLoopPorts,
  type ToolExecutionResult,
} from './agent-loop.solution';

type MockedPorts = AgentLoopPorts<string> & {
  executeTool: jest.Mock;
  checkpoint: jest.Mock;
  emit: jest.Mock;
};

function makePorts(overrides: Partial<AgentLoopPorts<string>> = {}): MockedPorts {
  return {
    executeTool: jest.fn(async (): Promise<ToolExecutionResult> => ({ status: 'success', output: 'ok' })),
    checkpoint: jest.fn(async (): Promise<void> => undefined),
    emit: jest.fn(),
    ...overrides,
  } as MockedPorts;
}

const toolDecision = () => ({
  type: 'tool' as const,
  name: 'demo_tool',
  input: { q: 1 },
  reduce: (s: string, o: unknown) => s + String(o),
});

const completeDecision = { type: 'complete' as const, output: 'done', reason: '完成' };

const model = (chunk: string) => ({
  type: 'model' as const,
  name: `model_${chunk}`,
  execute: async () => chunk,
  reduce: (s: string, o: unknown) => s + String(o),
});

describe('Lab 04 · 受控 Agent Loop（参考答案自检）', () => {
  it('测试 1（TODO-1）：预算入口消毒与每轮对表', async () => {
    const decideA = jest.fn(async () => completeDecision);
    const resultA = await runControlledLoop(
      { initialState: '', maxSteps: 0, maxToolCalls: 0, timeoutMs: 10_000, decide: decideA },
      makePorts(),
    );
    expect(resultA.status).toBe('completed');
    expect(resultA.steps).toBe(1);
    expect(resultA.output).toBe('done');

    const decideB = jest.fn(async () => completeDecision);
    const resultB = await runControlledLoop(
      { initialState: '', maxSteps: 5, maxToolCalls: 5, timeoutMs: 0, decide: decideB },
      makePorts(),
    );
    expect(resultB.status).toBe('failed');
    expect(resultB.terminationReason).toContain('Agent Loop 总超时');
    expect(resultB.steps).toBe(0);
    expect(decideB).not.toHaveBeenCalled();

    expect(decideA).toHaveBeenCalledWith('', { step: 1, toolCalls: 0, remainingMs: expect.any(Number) });
  });

  it('测试 2（TODO-2）：决策分支与工具预算前置', async () => {
    const executeToolA = jest.fn(async (): Promise<ToolExecutionResult> => ({ status: 'success', output: 'ok' }));
    const resultA = await runControlledLoop(
      { initialState: '', maxSteps: 5, maxToolCalls: 1, timeoutMs: 60_000, decide: async () => toolDecision() },
      makePorts({ executeTool: executeToolA }),
    );
    expect(resultA.status).toBe('budget_exceeded');
    expect(resultA.terminationReason).toContain('工具调用达到上限 1');
    expect(executeToolA).toHaveBeenCalledTimes(1);
    expect(resultA.steps).toBe(2);
    expect(resultA.toolCalls).toBe(1);

    const scriptB = [toolDecision(), completeDecision];
    const resultB = await runControlledLoop(
      {
        initialState: '',
        maxSteps: 5,
        maxToolCalls: 5,
        timeoutMs: 60_000,
        decide: async (_s, b) => scriptB[b.step - 1],
      },
      makePorts({ executeTool: jest.fn(async (): Promise<ToolExecutionResult> => ({ status: 'blocked' })) }),
    );
    expect(resultB.status).toBe('blocked');
    expect(resultB.steps).toBe(1);

    const scriptC = [toolDecision(), completeDecision];
    const resultC = await runControlledLoop(
      {
        initialState: '',
        maxSteps: 5,
        maxToolCalls: 5,
        timeoutMs: 60_000,
        decide: async (_s, b) => scriptC[b.step - 1],
      },
      makePorts({ executeTool: jest.fn(async (): Promise<ToolExecutionResult> => ({ status: 'success' })) }),
    );
    expect(resultC.status).toBe('failed');
    expect(resultC.steps).toBe(1);

    const scriptD = [toolDecision(), completeDecision];
    const resultD = await runControlledLoop(
      {
        initialState: '',
        maxSteps: 5,
        maxToolCalls: 5,
        timeoutMs: 60_000,
        decide: async (_s, b) => scriptD[b.step - 1],
      },
      makePorts({
        executeTool: jest.fn(async (): Promise<ToolExecutionResult> => ({ status: 'recovered', output: '历史结果' })),
      }),
    );
    expect(resultD.status).toBe('completed');
    expect(resultD.state).toBe('历史结果');
  });

  it('测试 3（TODO-3）：检查点时机与步数耗尽', async () => {
    const scriptA = [model('a'), model('b'), completeDecision];
    const portsA = makePorts();
    const resultA = await runControlledLoop(
      { initialState: '', maxSteps: 10, maxToolCalls: 0, timeoutMs: 60_000, decide: async (_s, b) => scriptA[b.step - 1] },
      portsA,
    );
    expect(resultA.status).toBe('completed');
    expect(resultA.steps).toBe(3);
    expect(resultA.state).toBe('ab');
    expect(portsA.checkpoint).toHaveBeenCalledTimes(2);
    expect(portsA.checkpoint.mock.calls.map((c) => c[1])).toEqual([1, 2]);
    expect(
      portsA.emit.mock.calls
        .filter(([event]) => event === 'agent.loop.round.completed')
        .map(([, payload]) => payload.step),
    ).toEqual([1, 2]);

    const portsB = makePorts();
    const resultB = await runControlledLoop(
      { initialState: '', maxSteps: 2, maxToolCalls: 0, timeoutMs: 60_000, decide: async () => model('x') },
      portsB,
    );
    expect(resultB.status).toBe('budget_exceeded');
    expect(resultB.terminationReason).toContain('执行步数达到上限 2');
    expect(resultB.steps).toBe(2);
    expect(resultB.state).toBe('xx');
    expect(portsB.checkpoint.mock.calls.map((c) => c[1])).toEqual([1, 2]);
  });
});
