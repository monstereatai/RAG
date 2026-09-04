import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { ToolExecutionService } from '../../tools/tool-execution.service';
import type {
  AgentLoopDecision,
  AgentLoopInput,
  AgentLoopResult,
  AgentLoopToolAction,
} from './agent-loop.types';

/**
 * 受控 Agent Loop：只负责“决策 → 模型／工具动作 → 结果回填 → 再决策”。
 * 业务 DAG、工具实现和审批规则仍由现有模块负责，避免模型越权改写工作流。
 */
@Injectable()
export class AgentLoopService {
  /**
   * 受预算约束的通用执行循环。这里集中处理步数、工具次数、总时限、检查点与审计事件，
   * 业务模块只能提供 `decide`／`reduce`，不能绕过工具权限策略自行执行副作用。
   */
  private readonly logger = new Logger(AgentLoopService.name);

  constructor(
    private readonly tools: ToolExecutionService,
    private readonly events: AgentRuntimeEventsService,
    private readonly redis: RedisProvider,
  ) {}

  /**
   * 执行「决策 → 动作 → 状态归约」直到完成、阻断或预算耗尽。
   * 任一轮成功后才写检查点，因此未知副作用结果不会被自动安全地假定为可重放。
   */
  async run<TState, TOutput>(
    input: AgentLoopInput<TState, TOutput>,
  ): Promise<AgentLoopResult<TState, TOutput>> {
    const startedAt = Date.now();
    const maxSteps = Math.max(1, input.maxSteps);
    const maxToolCalls = Math.max(0, input.maxToolCalls);
    let state = input.initialState;
    let toolCalls = 0;

    await this.emit(input, 'agent.loop.started', {
      maxSteps,
      maxToolCalls,
      timeoutMs: input.timeoutMs,
    });

    for (let step = 1; step <= maxSteps; step += 1) {
      const remainingMs = input.timeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        return this.finish(input, state, step - 1, toolCalls, 'failed', 'Agent Loop 总超时');
      }

      await this.emit(input, 'agent.loop.round.started', { step, toolCalls, remainingMs });
      let decision: AgentLoopDecision<TState, TOutput>;
      try {
        decision = await input.decide(state, { step, toolCalls, remainingMs });
      } catch (error) {
        return this.finish(
          input,
          state,
          step,
          toolCalls,
          'failed',
          error instanceof Error ? error.message : String(error),
        );
      }

      if (decision.type === 'complete') {
        return this.finish(input, state, step, toolCalls, 'completed', decision.reason, decision.output);
      }
      if (decision.type === 'blocked') {
        return this.finish(input, state, step, toolCalls, 'blocked', decision.reason);
      }

      // 工具动作经过 ToolExecutionService 的权限、审批和幂等保护；模型动作则受同一剩余时限约束。
      if (decision.type === 'tool') {
        if (toolCalls >= maxToolCalls) {
          return this.finish(input, state, step, toolCalls, 'budget_exceeded', `工具调用达到上限 ${maxToolCalls}`);
        }
        toolCalls += 1;
        const execution = await this.executeTool(input, decision, remainingMs);
        if (execution.status === 'blocked') {
          return this.finish(input, state, step, toolCalls, 'blocked', execution.error ?? `${decision.name} 被阻断`);
        }
        if (execution.status === 'failed' || execution.output === undefined) {
          return this.finish(input, state, step, toolCalls, 'failed', execution.error ?? `${decision.name} 执行失败`);
        }
        state = decision.reduce(state, execution.output);
      } else {
        const actionStartedAt = Date.now();
        await this.emit(input, 'agent.loop.model.started', { step, action: decision.name });
        try {
          const result = await this.withTimeout(decision.execute(), remainingMs, decision.name);
          state = decision.reduce(state, result);
          await this.emit(input, 'agent.loop.model.completed', {
            step,
            action: decision.name,
            durationMs: Date.now() - actionStartedAt,
          });
        } catch (error) {
          return this.finish(
            input,
            state,
            step,
            toolCalls,
            'failed',
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      await this.checkpoint(input, state, step, toolCalls);
      await this.emit(input, 'agent.loop.round.completed', { step, toolCalls });
    }

    return this.finish(input, state, maxSteps, toolCalls, 'budget_exceeded', `执行步数达到上限 ${maxSteps}`);
  }

  private executeTool<TState, TOutput>(
    input: AgentLoopInput<TState, TOutput>,
    action: AgentLoopToolAction<TState, unknown>,
    remainingMs: number,
  ) {
    return this.tools.execute({
      toolName: action.name,
      threadId: input.threadId,
      runId: input.runId,
      actor: input.actor,
      ownerUserId: action.ownerUserId,
      mode: action.mode,
      role: action.role,
      pluginKeys: action.pluginKeys,
      allowedToolNames: action.allowedToolNames,
      input: action.input,
      approvalPolicy: action.approvalPolicy,
      approvalGranted: action.approvalGranted,
      idempotencyKey: action.idempotencyKey,
      sideEffect: action.sideEffect,
      execute: () => this.withTimeout(action.execute(), remainingMs, action.name),
    });
  }

  private async checkpoint<TState, TOutput>(
    input: AgentLoopInput<TState, TOutput>,
    state: TState,
    step: number,
    toolCalls: number,
  ) {
    const snapshot = JSON.stringify({ step, toolCalls, state, updatedAt: new Date().toISOString() });
    const redisEnabled = this.redis.isEnabled();
    if (redisEnabled) {
      await this.redis.set(
        this.checkpointKey(input.threadId, input.actor),
        snapshot.slice(0, 100_000),
        input.checkpointTtlSeconds ?? 86_400,
      );
    }
    await this.emit(input, redisEnabled ? 'agent.loop.checkpoint.saved' : 'agent.loop.checkpoint.skipped', {
      step,
      toolCalls,
      redisEnabled,
      stateHash: createHash('sha256').update(snapshot).digest('hex').slice(0, 16),
    });
  }

  private async finish<TState, TOutput>(
    input: AgentLoopInput<TState, TOutput>,
    state: TState,
    steps: number,
    toolCalls: number,
    status: AgentLoopResult<TState, TOutput>['status'],
    terminationReason: string,
    output?: TOutput,
  ): Promise<AgentLoopResult<TState, TOutput>> {
    const result = { status, state, output, steps, toolCalls, terminationReason };
    await this.emit(input, `agent.loop.${status}`, { steps, toolCalls, terminationReason });
    return result;
  }

  private async emit<TState, TOutput>(
    input: AgentLoopInput<TState, TOutput>,
    eventType: string,
    payload: unknown,
  ) {
    try {
      await this.events.emit({
        threadId: input.threadId,
        runId: input.runId,
        eventType,
        actor: input.actor,
        payload,
      });
    } catch (error) {
      this.logger.warn(`Agent Loop event skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private checkpointKey(threadId: string, actor: string) {
    const scope = createHash('sha256').update(`${threadId}:${actor}`).digest('hex');
    return `agent-loop:checkpoint:${scope}`;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
