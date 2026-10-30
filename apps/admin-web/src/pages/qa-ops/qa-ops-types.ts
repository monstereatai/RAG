import type {
  ArtifactKind,
  ChatModel,
  GeneratedArtifact,
  ReferenceChunk,
} from './service';

export interface ArtifactFormValues {
  title: string;
  kind: ArtifactKind;
  sourceText: string;
  prompt?: string;
}

export interface ShareFormValues {
  visibility: 'internal' | 'external';
  expiresInHours?: number;
  maxDownloads?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status?: 'streaming' | 'done' | 'error';
  route?: string;
  confidence?: number;
  retryCount?: number;
  model?: ChatModel;
  retrievalSufficient?: boolean;
  retrievalReason?: string;
  references?: ReferenceChunk[];
  media?: AnswerMedia[];
  artifacts?: GeneratedArtifact[];
  events?: EventTraceItem[];
  runState?: RunStateView;
  animate?: boolean;
  /** 流式草稿只在内存累积，不在最终答案确认前展示。 */
  streamingDraft?: string;
}

export interface RunStateView {
  phase?: string;
  route?: string;
  model?: string;
  degradationReason?: string;
  evidence?: { sufficient?: boolean; reason?: string };
  citation?: { count?: number };
}

export interface AnswerMedia {
  id: string;
  type: 'image';
  url: string;
  alt?: string;
  title?: string;
}

export interface EventTraceItem {
  type: string;
  count: number;
}

export type TtsStatus = 'connecting' | 'synthesizing' | 'playing' | 'error';
