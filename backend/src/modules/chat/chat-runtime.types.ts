import type { ChatMode, ChatReference } from './chat.dto';
import type {
  RetrievedChunk,
  RetrievalScope,
} from '../../rag/karpathy/karpathy-rag.service';
import type { SseEvent } from '../../rag/agentic/sse-event';
import type {
  QueryPlan,
  QuerySourcePolicy,
} from '../../rag/planning/query-plan';
import type { RetrievalExecutionPlan } from '../../rag/planning/retrieval-policy.service';

/** 单次问答请求的不可变语义上下文，所有执行入口共享这一份决策。 */
export interface RequestContext {
  requestId: string;
  userId: string;
  tenantId?: string;
  threadId: string;
  query: string;
  mode: ChatMode;
  queryPlan: QueryPlan;
  executionPlan: RetrievalExecutionPlan;
  sourcePolicy: QuerySourcePolicy;
  scope?: RetrievalScope;
  deadlineAt: number;
  budget: {
    maxSteps: number;
    maxToolCalls: number;
    remainingSteps: number;
    remainingToolCalls: number;
  };
}

/** 可序列化的执行状态，作为流式事件和检查点的稳定摘要。 */
export interface ExecutionState {
  phase:
    | 'routing'
    | 'retrieval'
    | 'evidence'
    | 'generation'
    | 'reflection'
    | 'approval'
    | 'completed'
    | 'failed';
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

export interface SupplementalEvidenceContext {
  content: string;
  evidence: RetrievedChunk[];
}

export interface SupplementalEvidenceLoaderInput {
  queryPlan: QueryPlan;
  executionPlan: RetrievalExecutionPlan;
}

/** 在 QueryPlan 和后端执行策略确定后，按最终查询集合懒加载外部证据。 */
export type SupplementalEvidenceLoader = (
  input: SupplementalEvidenceLoaderInput,
) => Promise<SupplementalEvidenceContext>;
