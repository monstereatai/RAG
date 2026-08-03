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
