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
  route?: string;
  confidence?: number;
  retryCount?: number;
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
