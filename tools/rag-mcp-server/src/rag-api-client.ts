import { RagMcpError } from './errors.js';

export type ChatMode = 'simple' | 'agentic' | 'auto';

export interface ApiClientOptions {
  baseUrl: string;
  token?: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
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

export interface SearchResult {
  query: string;
  topK?: number;
  chunks?: SearchChunk[];
  results?: SearchChunk[];
  status?: string;
  retrievalSufficient?: boolean;
  retrievalReason?: string;
}

export interface ContextResult {
  task: string;
  status: 'ok' | 'insufficient_context';
  knowledge?: SearchChunk[];
  matchedSkills?: Array<Record<string, unknown>>;
  citations?: Array<Record<string, unknown>>;
  codingGuidance?: unknown;
  riskFlags?: string[];
  [key: string]: unknown;
}

export interface AskResult {
  answer?: string;
  references?: SearchChunk[];
  route?: string;
  confidence?: number;
  retryCount?: number;
  retrievalSufficient?: boolean;
  retrievalReason?: string;
  obsidianPaths?: string[];
  obsidianHits?: Array<Record<string, unknown>>;
  mode?: ChatMode;
  threadId?: string;
  [key: string]: unknown;
}

export interface SupervisorDomain {
  name: string;
  description: string;
}

export interface SupervisorResult {
  domain: string;
  answer: string;
  confidence: number;
  stages: Array<{
    agent: string;
    durationMs: number;
    confidence: number;
  }>;
  totalDurationMs: number;
}

interface ProductionWorkflowSummary {
  threadId: string;
  projectId: string;
  status: string;
  updatedAt?: string;
  completedRoles?: string[];
  selectedRoles?: string[];
}

export interface DocumentGovernanceItem {
  docId: string;
  filename: string;
  chunkCount: number;
  lifecycleStatus?: string;
  reviewStatus?: string;
  docVersion?: string | null;
  effectiveAt?: string | null;
  graphIndexStatus?: string;
  [key: string]: unknown;
}

export interface ScheduledJobSummary {
  id: string;
  name?: string;
  status?: string;
  schedule?: string;
  version?: number;
  isCurrent?: boolean;
  [key: string]: unknown;
}

interface LoginResult {
  accessToken?: string;
  token?: string;
}

export class RagApiClient {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private token?: string;

  constructor(private readonly options: ApiClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.token = options.token;
  }

  async health(): Promise<unknown> {
    return this.request<unknown>('/health', { auth: false });
  }

  async debugChunks(query: string, limit: number): Promise<SearchResult> {
    const params = new URLSearchParams({ query, k: String(limit) });
    return this.request<SearchResult>(`/debug/chunks?${params.toString()}`);
  }

  async search(query: string, limit: number): Promise<SearchResult> {
    try {
      return await this.request<SearchResult>('/rag/search', {
        method: 'POST',
        body: { query, limit },
      });
    } catch (error) {
      if (error instanceof RagMcpError && error.code === 'not_found') {
        return this.debugChunks(query, limit);
      }
      throw error;
    }
  }

  async contextPackage(input: {
    task: string;
    limit: number;
    includeRoadmap?: boolean;
    matchSkill?: boolean;
    skillLimit?: number;
  }): Promise<ContextResult> {
    return this.request<ContextResult>('/rag/context', {
      method: 'POST',
      body: input,
    });
  }

  async ask(input: { query: string; mode: ChatMode; threadId?: string }): Promise<AskResult> {
    return this.request<AskResult>('/chat', {
      method: 'POST',
      body: input,
    });
  }

  async graphQuery(query: string): Promise<unknown> {
    return this.request<unknown>('/graph/query', {
      method: 'POST',
      body: { query },
    });
  }

  async supervisorDomains(): Promise<SupervisorDomain[]> {
    return this.request<SupervisorDomain[]>('/supervisor/domains');
  }

  async supervisorQuery(query: string): Promise<SupervisorResult> {
    return this.request<SupervisorResult>('/supervisor/query', {
      method: 'POST',
      body: { query },
    });
  }

  async productionWorkflowCodingContext(activityName: string): Promise<Record<string, unknown>> {
    const completed = await this.completedProductionWorkflow(activityName);
    return this.request<Record<string, unknown>>(
      `/workflows/production/${encodeURIComponent(completed.threadId)}/coding-context`,
    );
  }

  async productionWorkflowHandoff(activityName: string): Promise<Record<string, unknown>> {
    return buildProductionWorkflowHandoff(
      await this.productionWorkflowCodingContext(activityName),
    );
  }

  private async completedProductionWorkflow(activityName: string): Promise<ProductionWorkflowSummary> {
    const workflows = await this.productionWorkflowActivities();
    const normalized = activityName.trim().toLowerCase();
    const matches = workflows
      .filter((workflow) => workflow.projectId?.toLowerCase() === normalized || workflow.projectId?.toLowerCase().includes(normalized))
      .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    const completed = matches.find((workflow) => workflow.status === 'completed');
    if (!completed) {
      throw new RagMcpError(
        'not_found',
        matches.length > 0
          ? `activity "${activityName}" has no completed production workflow`
          : `no production workflow matched activity "${activityName}"`,
        { recoverable: true },
      );
    }
    return completed;
  }

  async productionWorkflowActivities(): Promise<ProductionWorkflowSummary[]> {
    return this.request<ProductionWorkflowSummary[]>('/workflows/production');
  }

  async productionWorkflowStatus(threadId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/workflows/production/${encodeURIComponent(threadId)}`,
    );
  }

  async listDocuments(): Promise<DocumentGovernanceItem[]> {
    return this.request<DocumentGovernanceItem[]>('/documents');
  }

  async documentStatus(docId: string): Promise<DocumentGovernanceItem> {
    return this.request<DocumentGovernanceItem>(`/documents/${encodeURIComponent(docId)}`);
  }

  async documentTaskStatus(taskId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`/documents/tasks/${encodeURIComponent(taskId)}`);
  }

  async listScheduledJobs(): Promise<ScheduledJobSummary[]> {
    return this.request<ScheduledJobSummary[]>('/jobs');
  }

  async scheduledJobExecutions(jobId: string): Promise<Record<string, unknown>[]> {
    return this.request<Record<string, unknown>[]>(`/jobs/${encodeURIComponent(jobId)}/executions`);
  }

  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      auth?: boolean;
    } = {},
  ): Promise<T> {
    const auth = options.auth ?? true;
    if (auth && !this.token) {
      await this.loginWithConfiguredCredentials();
    }
    if (auth && !this.token) {
      throw new RagMcpError(
        'unauthorized',
        'missing token, set RAG_MCP_TOKEN/RAG_TOKEN, set RAG_MCP_USERNAME/RAG_MCP_PASSWORD, or run rag auth login',
        {
          recoverable: true,
        },
      );
    }

    try {
      return await this.requestOnce<T>(path, options);
    } catch (error) {
      if (auth && error instanceof RagMcpError && error.code === 'unauthorized' && this.hasLoginCredentials()) {
        this.token = undefined;
        await this.loginWithConfiguredCredentials();
        return this.requestOnce<T>(path, options);
      }
      throw error;
    }
  }

  private async requestOnce<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      auth?: boolean;
    } = {},
  ): Promise<T> {
    const auth = options.auth ?? true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (auth && this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    try {
      const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        throw httpError(response.status, payload);
      }
      return unwrapResponse<T>(payload);
    } catch (error) {
      if (error instanceof RagMcpError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RagMcpError('service_unavailable', `request timeout after ${this.timeoutMs}ms`, {
          recoverable: true,
        });
      }
      if (error instanceof TypeError) {
        throw new RagMcpError('service_unavailable', `service unavailable: ${error.message}`, {
          recoverable: true,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private hasLoginCredentials(): boolean {
    return Boolean(this.options.username && this.options.password);
  }

  private async loginWithConfiguredCredentials(): Promise<void> {
    if (!this.options.username || !this.options.password) {
      return;
    }
    const result = await this.requestOnce<LoginResult>('/auth/login', {
      method: 'POST',
      body: {
        username: this.options.username,
        password: this.options.password,
      },
      auth: false,
    });
    this.token = result.accessToken ?? result.token;
  }
}

export function buildProductionWorkflowHandoff(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const stages = Array.isArray(context.stages)
    ? (context.stages as Array<Record<string, unknown>>)
    : [];
  const schemas: Array<Record<string, unknown>> = stages.flatMap((stage) =>
    (Array.isArray(stage.lowCodeSchemas) ? stage.lowCodeSchemas : []).map(
      (schema) => ({ role: stage.role, ...(schema as Record<string, unknown>) }),
    ),
  );
  const citations: Array<Record<string, unknown>> = stages.flatMap((stage) =>
    (Array.isArray(stage.evidence) ? stage.evidence : []).map((evidence) => ({
      role: stage.role,
      ...(evidence as Record<string, unknown>),
    })),
  );
  const markdown = [
    `# ${String(context.projectId ?? '产研运项目')} AI Coding 交接包`,
    '适用于 Codex、Claude、Cursor 等 AI Coding 工具。先依据下方岗位交接物实施，再以 Schema 与 RAG 引用证据核对实现。',
    ...stages.map((stage) => {
      const deliverables = Array.isArray(stage.deliverables)
        ? (stage.deliverables as Array<Record<string, unknown>>)
        : [];
      return [
        `## ${String(stage.role ?? 'stage')}`,
        String(stage.summary ?? ''),
        ...deliverables.map(
          (item) => `### ${String(item.title ?? '交付物')}\n\n${String(item.markdown ?? '')}`,
        ),
      ].join('\n\n');
    }),
    '## RAG 引用证据',
    citations.length > 0
      ? citations.map((item) => `- [${String(item.role ?? 'unknown')}] ${String(item.id ?? 'unknown')}：文档 ${String(item.docId ?? 'unknown')}／片段 ${String(item.chunkIndex ?? 'unknown')}／评分 ${String(item.totalScore ?? 'unknown')}\n  - ${String(item.excerpt ?? '')}`).join('\n')
      : '本次工作流未检索到可引用的 RAG 证据。',
  ].join('\n\n');
  return {
    formatVersion: 1,
    artifactName: `${String(context.projectId ?? 'production-workflow')}-handoff`,
    threadId: context.threadId,
    projectId: context.projectId,
    markdown,
    schemas,
    citations,
  };
}

async function readPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

function unwrapResponse<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'code' in payload && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function httpError(status: number, payload: unknown): RagMcpError {
  const message = extractMessage(payload) ?? `HTTP ${status}`;
  if (status === 401) {
    return new RagMcpError('unauthorized', message, { recoverable: true, details: payload });
  }
  if (status === 403) {
    return new RagMcpError('forbidden', message, { recoverable: false, details: payload });
  }
  if (status === 404) {
    return new RagMcpError('not_found', message, { recoverable: true, details: payload });
  }
  return new RagMcpError('server_error', message, { recoverable: false, details: payload });
}

function extractMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return typeof payload === 'string' ? payload : undefined;
  }
  const record = payload as Record<string, unknown>;
  const message = record.message;
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message)) {
    return message.join(', ');
  }
  return undefined;
}
