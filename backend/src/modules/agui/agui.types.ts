import type { ChatMode } from '../chat/chat.dto';
import type { LlmModelProvider } from '../../providers/llm/llm-provider.interface';

export type AguiEventType =
  | 'RUN_STARTED'
  | 'RUN_FINISHED'
  | 'RUN_ERROR'
  | 'TEXT_MESSAGE_START'
  | 'TEXT_MESSAGE_CONTENT'
  | 'TEXT_MESSAGE_END'
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_ARGS'
  | 'TOOL_CALL_END'
  | 'STATE_DELTA'
  | 'CUSTOM';

export interface AguiEvent {
  type: AguiEventType;
  runId: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export type AguiRunPhase =
  | 'routing'
  | 'retrieval'
  | 'evidence'
  | 'generation'
  | 'citation'
  | 'completed'
  | 'degraded'
  | 'error';

/** 跨模型、检索、证据门禁与 Agent Loop 的统一运行状态。 */
export interface AguiRunState {
  phase: AguiRunPhase;
  mode?: ChatMode;
  model?: string;
  route?: string;
  retrieval?: { status: 'pending' | 'completed' | 'unavailable'; count?: number };
  evidence?: { sufficient?: boolean; reason?: string };
  citation?: { count?: number };
  degradationReason?: string;
}

export interface AguiStreamOptions {
  query: string;
  mode: ChatMode;
  userId: string;
  threadId?: string;
  model?: LlmModelProvider;
  rolePresetId?: string;
  pluginKeys?: string[];
}
