/**
 * Lab 04 · 验收测试（学员版）
 *
 * 3 个用例逐一对应 3 处 TODO：测试 1 ←→ TODO-1（入口消毒与对表）；
 * 测试 2 ←→ TODO-2（决策分支与工具预算前置）；测试 3 ←→ TODO-3（检查点时机与步数耗尽）。
 * 实现前应 3 个全红；逐一修复后逐步转绿。
 */
import {
  runControlledLoop,
  type AgentLoopPorts,
  type ToolExecutionResult,
} from './agent-loop.student';

type MockedPorts = AgentLoopPorts<string> & {
  executeTool: jest.Mock;
  checkpoint: jest.Mock;
  emit: jest.Mock;
};

/** 构造注入端口：全部用 jest.fn 打桩，便于断言调用次数与参数（生产中是 ToolExecutionService / Redis / 事件服务） */
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

describe('Lab 04 · 受控 Agent Loop（学员版）', () => {
  it('测试 1（TODO-1）：预算入口消毒与每轮对表', async () => {
    // (a) maxSteps=0 也要钳到 1：至少跑一步，拿到 complete 的输出
    const decideA = jest.fn(async () => completeDecision);
    const resultA = await runControlledLoop(
      { initialState: '', maxSteps: 0, maxToolCalls: 0, timeoutMs: 10_000, decide: decideA },
      makePorts(),
    );
    expect(resultA.status).toBe('completed');
    expect(resultA.steps).toBe(1);
    expect(resultA.output).toBe('done');

    // (b) timeoutMs=0：第一步之前对表就应失败，decide 一次都不能被调用
    const decideB = jest.fn(async () => completeDecision);
    const resultB = await runControlledLoop(
      { initialState: '', maxSteps: 5, maxToolCalls: 5, timeoutMs: 0, decide: decideB },
      makePorts(),
    );
    expect(resultB.status).toBe('failed');
    expect(resultB.terminationReason).toContain('Agent Loop 总超时');
    expect(resultB.steps).toBe(0);
    expect(decideB).not.toHaveBeenCalled();

    // (c) decide 收到预算上下文（第 4 节 §3.2：预算感知决策的原料）
    expect(decideA).toHaveBeenCalledWith('', { step: 1, toolCalls: 0, remainingMs: expect.any(Number) });
  });

  it('测试 2（TODO-2）：决策分支与工具预算前置', async () => {
    // (a) 预算检查在执行之前：maxToolCalls=1 时，第二次 tool 决策的那次调用根本不发出
    const executeToolA = jest.fn(async (): Promise<ToolExecutionResult> => ({ status: 'success', output: 'ok' }));
    const resultA = await runControlledLoop(
      { initialState: '', maxSteps: 5, maxToolCalls: 1, timeoutMs: 60_000, decide: async () => toolDecision() },
      makePorts({ executeTool: executeToolA }),
    );
    expect(resultA.status).toBe('budget_exceeded');
    expect(resultA.terminationReason).toContain('工具调用达到上限 1');
    expect(executeToolA).toHaveBeenCalledTimes(1); // 核心断言：先执行再检查会得到 2
    expect(resultA.steps).toBe(2);
    expect(resultA.toolCalls).toBe(1);

    // (b) 工具 blocked：循环以 blocked 终止，而不是跳过继续
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

    // (c) success 但无输出：契约违例按 failed 终止
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

    // (d) recovered 带历史输出：按成功处理，状态被回填（第 3 节语义）
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
    // (a) 检查点只写在"每轮成功后"：完成轮（step 3 的 complete）不落快照
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

    // (b) 步数用尽：budget_exceeded，理由是生产原文
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
