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

export interface AguiStreamOptions {
  query: string;
  mode: ChatMode;
  userId: string;
  threadId?: string;
  model?: LlmModelProvider;
  rolePresetId?: string;
  pluginKeys?: string[];
}
