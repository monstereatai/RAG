import type { ToolApprovalPolicy } from '../../tools/tool-execution.service';
import type { McpToolView } from '../../providers/mcp/mcp.provider';

export type AgentLoopStatus =
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'budget_exceeded'
  | 'cancelled';

interface AgentLoopActionBase<TState, TResult> {
  name: string;
  input?: unknown;
  execute: (signal?: AbortSignal) => Promise<TResult>;
  reduce: (state: TState, result: TResult) => TState;
}

export interface AgentLoopModelAction<
  TState,
  TResult,
> extends AgentLoopActionBase<TState, TResult> {
  type: 'model';
}

export interface AgentLoopToolAction<
  TState,
  TResult,
> extends AgentLoopActionBase<TState, TResult> {
  type: 'tool';
  ownerUserId?: string;
  approvalPolicy?: ToolApprovalPolicy;
  approvalGranted?: boolean;
  idempotencyKey?: string;
  sideEffect?: boolean;
  /** 仅当后续代码必须读取完整结构化结果时启用；否则状态只接收 ToolExecutionService 的有界结果。 */
  preserveFullOutput?: boolean;
  role?: string;
  mode: 'auto' | 'agentic' | 'production';
  pluginKeys?: string[];
  allowedToolNames?: string[];
}

export type AgentLoopDecision<TState, TOutput> =
  | AgentLoopModelAction<TState, unknown>
  | AgentLoopToolAction<TState, unknown>
  | { type: 'complete'; output: TOutput; reason: string }
  | { type: 'blocked'; reason: string };

export interface AgentLoopInput<TState, TOutput> {
  threadId: string;
  runId?: string;
  taskId?: string;
  actor: string;
  initialState: TState;
  maxSteps: number;
  maxToolCalls: number;
  timeoutMs: number;
  checkpointTtlSeconds?: number;
  signal?: AbortSignal;
  /** Must come from authenticated server context; never accept this value from model tool input. */
  tenantId?: string;
  decide: (
    state: TState,
    context: {
      step: number;
      toolCalls: number;
      remainingMs: number;
      signal: AbortSignal;
      mcpTools: McpToolView[];
    },
  ) =>
    | Promise<AgentLoopDecision<TState, TOutput>>
    | AgentLoopDecision<TState, TOutput>;
}

export interface AgentLoopCheckpoint<TState> {
  version: 1;
  threadId: string;
  actor: string;
  runId?: string;
  taskId?: string;
  step: number;
  toolCalls: number;
  /** 从本次运行开始累计的执行时间，用于恢复时继续消耗同一总超时预算。 */
  elapsedMs?: number;
  state: TState;
  updatedAt: string;
}

export type AgentLoopResumeFailureCode =
  | 'redis_unavailable'
  | 'missing_checkpoint'
  | 'invalid_checkpoint'
  | 'identity_mismatch'
  | 'checkpoint_expired'
  | 'budget_exceeded'
  | 'cancelled';

export class AgentLoopResumeError extends Error {
  constructor(
    readonly code: AgentLoopResumeFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgentLoopResumeError';
  }
}

export interface AgentLoopResult<TState, TOutput> {
  status: AgentLoopStatus;
  state: TState;
  output?: TOutput;
  steps: number;
  toolCalls: number;
  terminationReason: string;
}
