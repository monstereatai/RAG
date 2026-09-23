// 后端 API 响应类型
export interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
}

// 文档相关
export interface UploadResponse {
  docId: string;
  chunkCount: number;
}

export interface DocumentItem {
  docId: string;
  filename: string;
  chunkCount: number;
  createdAt: string;
}

// 聊天相关
export type ChatMode = 'simple' | 'agentic' | 'auto';

export interface RolePreset {
  id: string;
  name: string;
  shortName: string;
  summary: string;
  responsibilities: string[];
  starterTasks: string[];
  suggestedQuestions: string[];
  roleScope?: string;
  answerGuidance: string;
}

export interface RolePresetCatalog {
  defaultRolePresetId: string;
  roles: RolePreset[];
}

export interface ReferenceChunk {
  id: string;
  content: string;
  docId: string;
  chunkIndex: number;
  totalScore: number;
  bm25Score: number;
  cosineScore: number;
}

export interface ChatResponse {
  answer: string;
  references: ReferenceChunk[];
  threadId?: string;
  route?: string;
  confidence?: number;
  retryCount?: number;
  retrievalSufficient?: boolean;
  retrievalReason?: string;
}

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

// Debug 相关
export interface DebugChunk {
  id: string;
  content: string;
  docId: string;
  chunkIndex: number;
  bm25Score: number;
  cosineScore: number;
  totalScore: number;
}

export interface DebugResponse {
  query: string;
  topK: number;
  chunks: DebugChunk[];
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
}

export interface UserInfo {
  userId: string;
  username: string;
  role: string;
}
