import type { ToolApprovalPolicy } from '../../tools/tool-execution.service';

export type AgentLoopStatus = 'completed' | 'blocked' | 'failed' | 'budget_exceeded';

interface AgentLoopActionBase<TState, TResult> {
  name: string;
  input?: unknown;
  execute: () => Promise<TResult>;
  reduce: (state: TState, result: TResult) => TState;
}

export interface AgentLoopModelAction<TState, TResult>
  extends AgentLoopActionBase<TState, TResult> {
  type: 'model';
}

export interface AgentLoopToolAction<TState, TResult>
  extends AgentLoopActionBase<TState, TResult> {
  type: 'tool';
  ownerUserId?: string;
  approvalPolicy?: ToolApprovalPolicy;
  approvalGranted?: boolean;
  idempotencyKey?: string;
  sideEffect?: boolean;
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
  actor: string;
  initialState: TState;
  maxSteps: number;
  maxToolCalls: number;
  timeoutMs: number;
  checkpointTtlSeconds?: number;
  decide: (
    state: TState,
    context: { step: number; toolCalls: number; remainingMs: number },
  ) => Promise<AgentLoopDecision<TState, TOutput>> | AgentLoopDecision<TState, TOutput>;
}

export interface AgentLoopResult<TState, TOutput> {
  status: AgentLoopStatus;
  state: TState;
  output?: TOutput;
  steps: number;
  toolCalls: number;
  terminationReason: string;
}
