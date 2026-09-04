/**
 * Lab 04 · 受控 Agent Loop —— 学员修复版
 *
 * 这是 backend/src/modules/agent-loop/agent-loop.service.ts（生产 219 行）的教学提取版：
 * NestJS 依赖注入简化为 ports 参数，循环语义与生产逐条对应（每个 TODO 注释标注生产行号）。
 * 讲义：../README.md（重点 §3.1 入口消毒 / §3.3 工具预算前置 / §3.4 检查点时机）
 *
 * 玩法：本文件含 3 处与生产语义不符的"错误实现"（TODO-1/2/3）。
 * 运行 agent-loop.student.spec.ts 应 3 个全红；逐一修复后应 3 个全绿。
 */

//#region 类型定义（给定的基础设施，无需修改）

export type AgentLoopStatus = 'completed' | 'blocked' | 'failed' | 'budget_exceeded';

/** 工具执行结果四态（第 3 节：success / recovered / blocked / failed） */
export interface ToolExecutionResult {
  status: 'success' | 'recovered' | 'blocked' | 'failed';
  output?: unknown;
  error?: string;
}

/** 决策四类型（生产 agent-loop.types.ts：判别联合，"结构即约束"） */
export type LabDecision<S> =
  | { type: 'model'; name: string; execute: () => Promise<unknown>; reduce: (state: S, output: unknown) => S }
  | { type: 'tool'; name: string; input: unknown; reduce: (state: S, output: unknown) => S }
  | { type: 'complete'; output: unknown; reason: string }
  | { type: 'blocked'; reason: string };

/** 生产中 ToolExecutionService / Redis checkpoint / AgentRuntimeEvents 的注入替代 */
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

//#endregion

export async function runControlledLoop<S>(
  input: AgentLoopInput<S>,
  ports: AgentLoopPorts<S>,
): Promise<AgentLoopResult<S>> {
  const startedAt = Date.now();
  let state = input.initialState;
  let toolCalls = 0;

  // 对应生产 finish()（L169-181）：统一组装结果并发终止事件
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

  // 对应生产 L44-48：启动事件
  ports.emit('agent.loop.started', {
    maxSteps: input.maxSteps,
    maxToolCalls: input.maxToolCalls,
    timeoutMs: input.timeoutMs,
  });

  // ===== TODO-1（生产 L39-40 / L51-54）=====
  // 当前实现与生产语义不符：
  //   ① maxSteps / maxToolCalls 没有入口消毒（调用方传 0 或负数时，生产怎么钳制？）
  //   ② 循环里算了 remainingMs 却没有对表——总时限耗尽应以 failed 终止，
  //      reason 用生产原文 'Agent Loop 总超时'；注意超时的那一轮没有执行，steps 传多少？
  const maxSteps = input.maxSteps;
  const maxToolCalls = input.maxToolCalls;

  for (let step = 1; step <= maxSteps; step += 1) {
    // TODO-3①：位置错误——生产把检查点写在"每轮成功后"（L115-116），不是每轮开头
    await ports.checkpoint(state, step, toolCalls);
    ports.emit('agent.loop.round.completed', { step, toolCalls });

    const remainingMs = input.timeoutMs - (Date.now() - startedAt);
    // TODO-1②：在这里补上对表

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
      // ===== TODO-2（生产 L79-91）=====
      // 当前实现与生产语义有三处不符：
      //   ① 预算检查在执行之后（生产：执行前拦截，超限的那次调用根本不发出）
      //   ② 工具 blocked / failed 时 continue 跳过（生产：以对应状态直接终止循环）
      //   ③ status 为 success 但 output === undefined 时照常 reduce（生产：契约违例按 failed 终止）
      const execution = await ports.executeTool({ name: decision.name, input: decision.input }, remainingMs);
      toolCalls += 1;
      if (toolCalls > maxToolCalls) {
        return finish('budget_exceeded', step, `工具调用达到上限 ${maxToolCalls}`);
      }
      if (execution.status === 'blocked' || execution.status === 'failed') {
        continue;
      }
      state = decision.reduce(state, execution.output);
      continue;
    }

    // model 动作（给定）：生产 L92-113 还有 withTimeout 与异常转 failed 的包装，Lab 简化为直接执行
    const result = await decision.execute();
    state = decision.reduce(state, result);
  }

  // ===== TODO-3②（生产 L119）=====
  // 循环正常走完（没有被 return）意味着什么？当前返回 completed 是错的——
  // 生产的语义是预算性终止，reason 用生产原文 `执行步数达到上限 ${maxSteps}`。
  return finish('completed', maxSteps, '循环结束');
}
