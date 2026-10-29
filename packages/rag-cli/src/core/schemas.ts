import { z } from 'zod';

export const formatSchema = z.enum(['json', 'markdown', 'table']);
export type OutputFormat = z.infer<typeof formatSchema>;

export const chatModeSchema = z.enum(['simple', 'agentic', 'auto']);
export type ChatMode = z.infer<typeof chatModeSchema>;

export const baseOptionsSchema = z.object({
  baseUrl: z.string().optional(),
  token: z.string().optional(),
  format: formatSchema.default('markdown'),
  timeout: z.coerce.number().int().positive().default(15000),
  quiet: z.boolean().default(false),
  verbose: z.boolean().default(false),
});

export type BaseOptions = z.infer<typeof baseOptionsSchema>;

export interface LoginResult {
  accessToken?: string;
  token?: string;
  user?: unknown;
  [key: string]: unknown;
}

export interface ProfileResult {
  userId?: string;
  username?: string;
  role?: string;
  [key: string]: unknown;
}

export interface SearchChunk {
  id?: string;
  chunkId?: string;
  docId?: string;
  content: string;
  title?: string;
  chunkIndex?: number;
  bm25Score?: number;
  cosineScore?: number;
  totalScore?: number;
  score?: number;
  source?: Record<string, unknown>;
}

export interface RagReference extends SearchChunk {
  headingPath?: string[];
  sourceAuthority?: string;
}

export interface SearchResult {
  query: string;
  topK?: number;
  chunks?: SearchChunk[];
  results?: SearchChunk[];
  status?: string;
}

export interface ContextResult {
  task: string;
  status: 'ok' | 'insufficient_context';
  knowledge?: SearchChunk[];
  matchedSkills?: SkillMatch[];
  citations?: Array<{
    id: number;
    docId?: string;
    chunkId?: string;
    title?: string;
    score?: number;
  }>;
  codingGuidance?: unknown;
  riskFlags?: string[];
  [key: string]: unknown;
}

export interface AskResult {
  answer?: string;
  references?: RagReference[];
  route?: string;
  confidence?: number;
  retryCount?: number;
  retrievalSufficient?: boolean;
  retrievalReason?: string;
  obsidianPaths?: string[];
  obsidianHits?: Array<{
    path: string;
    type?: string;
    title?: string;
    score?: number;
    tags?: string[];
  }>;
  mode?: ChatMode;
  threadId?: string;
  [key: string]: unknown;
}

export interface SkillMatch {
  name: string;
  description?: string;
  score?: number;
  tags?: string[];
  matchedTerms?: string[];
  matchMode?: string;
  semanticScore?: number;
  sourcePath?: string;
}

export interface DocumentItem {
  docId?: string;
  id?: string;
  filename?: string;
  name?: string;
  title?: string;
  chunkCount?: number;
  createdAt?: string;
  [key: string]: unknown;
}

export interface SseEvent {
  type?: string;
  data?: unknown;
}
