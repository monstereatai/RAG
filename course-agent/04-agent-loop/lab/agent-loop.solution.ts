/**
 * Lab 04 · 受控 Agent Loop —— 参考答案
 *
 * 与学员版（agent-loop.student.ts）的骨架逐段对应，仅修正三处 TODO 的语义。
 * 循环语义逐条对齐生产 backend/src/modules/agent-loop/agent-loop.service.ts（行号见各注释）。
 * 注意：这是教学提取版（ports 注入替代 Nest DI），非逐字节拷贝——
 * 生产的 withTimeout / Redis 快照细节 / 事件服务 在 Lab 中被注入化，语义保持一致。
 */

export type AgentLoopStatus = 'completed' | 'blocked' | 'failed' | 'budget_exceeded';

export interface ToolExecutionResult {
  status: 'success' | 'recovered' | 'blocked' | 'failed';
  output?: unknown;
  error?: string;
}

export type LabDecision<S> =
  | { type: 'model'; name: string; execute: () => Promise<unknown>; reduce: (state: S, output: unknown) => S }
  | { type: 'tool'; name: string; input: unknown; reduce: (state: S, output: unknown) => S }
  | { type: 'complete'; output: unknown; reason: string }
  | { type: 'blocked'; reason: string };

export interface AgentLoopPorts<S> {
  executeTool(action: { name: string; input: unknown }, remainingMs: number): Promise<ToolExecutionResult>;
  checkpoint(state: S, step: number, toolCalls: number): Promise<void>;
  emit(eventType: string, payload: Record<string, unknown>): void;
}

export interface AgentLoopInput<S> {
  initialState: S;
  maxSteps: number;
  maxToolCalls: number;
  timeoutMs: number;
  decide(state: S, budget: { step: number; toolCalls: number; remainingMs: number }): Promise<LabDecision<S>>;
}

export interface AgentLoopResult<S> {
  status: AgentLoopStatus;
  state: S;
  output?: unknown;
  steps: number;
  toolCalls: number;
  terminationReason: string;
}

export async function runControlledLoop<S>(
  input: AgentLoopInput<S>,
  ports: AgentLoopPorts<S>,
): Promise<AgentLoopResult<S>> {
  const startedAt = Date.now();
  let state = input.initialState;
  let toolCalls = 0;

  const finish = (
    status: AgentLoopStatus,
    steps: number,
    terminationReason: string,
    output?: unknown,
  ): AgentLoopResult<S> => {
    const result = { status, state, output, steps, toolCalls, terminationReason };
    ports.emit(`agent.loop.${status}`, { steps, toolCalls, terminationReason });
    return result;
  };

  ports.emit('agent.loop.started', {
    maxSteps: input.maxSteps,
    maxToolCalls: input.maxToolCalls,
    timeoutMs: input.timeoutMs,
  });

  // 生产 L39-40：预算入口消毒——maxSteps 至少 1 步（钳 0/负数），maxToolCalls 允许 0（纯模型循环）
  const maxSteps = Math.max(1, input.maxSteps);
  const maxToolCalls = Math.max(0, input.maxToolCalls);

  for (let step = 1; step <= maxSteps; step += 1) {
    // 生产 L51-54：每轮先对表——超时的这一轮没有执行，steps 传 step - 1
    const remainingMs = input.timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      return finish('failed', step - 1, 'Agent Loop 总超时');
    }

    ports.emit('agent.loop.round.started', { step, toolCalls, remainingMs });
    let decision: LabDecision<S>;
    try {
      decision = await input.decide(state, { step, toolCalls, remainingMs });
    } catch (error) {
      return finish('failed', step, error instanceof Error ? error.message : String(error));
    }

    if (decision.type === 'complete') {
      return finish('completed', step, decision.reason, decision.output);
    }
    if (decision.type === 'blocked') {
      return finish('blocked', step, decision.reason);
    }

    if (decision.type === 'tool') {
      // 生产 L80-82：预算检查在执行之前——超限的那次调用根本不发出
      if (toolCalls >= maxToolCalls) {
        return finish('budget_exceeded', step, `工具调用达到上限 ${maxToolCalls}`);
      }
      toolCalls += 1;
      const execution = await ports.executeTool({ name: decision.name, input: decision.input }, remainingMs);
      // 生产 L85-90：blocked / failed（含 success 但无输出的契约违例）都是终态，直接终止循环
      if (execution.status === 'blocked') {
        return finish('blocked', step, execution.error ?? `${decision.name} 被阻断`);
      }
      if (execution.status === 'failed' || execution.output === undefined) {
        return finish('failed', step, execution.error ?? `${decision.name} 执行失败`);
      }
      state = decision.reduce(state, execution.output);
    } else {
      const result = await decision.execute();
      state = decision.reduce(state, result);
    }

    // 生产 L115-116：每轮成功后写检查点 + 发轮次完成事件（complete/blocked/预算拦截轮不落快照）
    await ports.checkpoint(state, step, toolCalls);
    ports.emit('agent.loop.round.completed', { step, toolCalls });
  }

  // 生产 L119：步数用尽是预算性终止，不是完成
  return finish('budget_exceeded', maxSteps, `执行步数达到上限 ${maxSteps}`);
}
