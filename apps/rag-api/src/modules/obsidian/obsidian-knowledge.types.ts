export interface ObsidianSearchHit {
  path: string;
  type: 'compiled' | 'index' | 'note';
  isSourceNote?: boolean;
  title: string;
  content: string;
  score: number;
  ragDocId?: string;
  sourceUrl?: string;
  tags: string[];
}

export interface ObsidianAccessContext {
  userId?: string;
  roles?: string[];
  tenantId?: string;
}

export interface ObsidianNoteDraft {
  summary: string[];
  keyPoints: string[];
  tags: string[];
  topics: string[];
  entities: string[];
  keyConclusions: string[];
  objections: string[];
  boundaries: string[];
  risks: string[];
  acceptanceCriteria: string[];
}

export interface ObsidianSourceInput {
  userId: string;
  title: string;
  sourceUrl?: string;
  content: string;
  /** 原始输入正文的 SHA-256；异步从数据库重建正文时仍用它稳定去重。 */
  contentHash?: string;
  ragDocId?: string;
  sourceType: 'url' | 'document' | 'official-docs' | 'manual';
  contentType?: string;
  filename?: string;
}

export interface ObsidianWriteResult {
  status: 'saved' | 'duplicate' | 'failed';
  notePath?: string;
  rawPath?: string;
  error?: string;
  title: string;
  tags: string[];
  contentHash: string;
  ragDocId?: string;
}

export type ProjectWorkflowType =
  | 'solution'
  | 'tech-selection'
  | 'adr'
  | 'task-breakdown';

export interface ProjectWorkflowInput {
  type: ProjectWorkflowType;
  title: string;
  question: string;
  context?: string;
  constraints?: string[];
  options?: string[];
}

export interface ProjectWorkflowResult {
  type: ProjectWorkflowType;
  title: string;
  path: string;
  obsidianPaths: string[];
  content: string;
}

export interface ObsidianSourceLookup {
  notePath: string;
  ragDocId?: string;
  title: string;
  tags: string[];
  contentHash: string;
}

export interface ObsidianGraphSeed {
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    sourceId: string;
  }>;
  relationships: Array<{
    source: string;
    target: string;
    type: string;
    sourceId: string;
    confidence: number;
  }>;
}
