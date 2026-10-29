import type { ChatMode, ChatReference } from './chat.dto';
import type { SseEvent } from '../../rag/agentic/sse-event';

export type { RequestContext } from '../../rag/contracts/request-context';
export type {
  SupplementalEvidenceContext,
  SupplementalEvidenceLoader,
  SupplementalEvidenceLoaderInput,
} from '../../rag/contracts/supplemental-evidence';

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
