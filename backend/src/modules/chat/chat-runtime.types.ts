import type { ChatMode, ChatReference } from './chat.dto';
import type { QueryIntent } from '../../rag/prompts/query-intent-router';
import type { RetrievalScope } from '../../rag/karpathy/karpathy-rag.service';
import type { SseEvent } from '../../rag/agentic/sse-event';

/** 单次问答请求的不可变语义上下文，所有执行入口共享这一份决策。 */
export interface RequestContext {
  requestId: string;
  userId: string;
  threadId: string;
  query: string;
  mode: ChatMode;
  queryIntent: QueryIntent;
  sourcePolicy: QueryIntent['sourcePolicy'];
  scope?: RetrievalScope;
  deadlineAt: number;
  budget: { maxSteps: number; maxToolCalls: number; remainingSteps: number; remainingToolCalls: number };
}

/** 可序列化的执行状态，作为流式事件和检查点的稳定摘要。 */
export interface ExecutionState {
  phase: 'routing' | 'retrieval' | 'evidence' | 'generation' | 'reflection' | 'approval' | 'completed' | 'failed';
  route?: 'simple' | 'agentic';
  consumedSteps: number;
  consumedToolCalls: number;
  retryCount: number;
  checkpointId?: string;
  paused?: boolean;
  reason?: string;
}

export interface ChatResult {
  answer: string;
  references: ChatReference[];
  mode: ChatMode;
  route: 'simple' | 'agentic';
  threadId: string;
  runId?: string;
  queryLogId?: string;
  confidence?: number;
  retrievalSufficient?: boolean;
  retrievalReason?: string;
  executionState?: ExecutionState;
}

export type ChatEventCallback = (event: SseEvent) => void;
