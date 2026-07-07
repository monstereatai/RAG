import { CliError } from './errors.js';
import type {
  AskResult,
  ChatMode,
  DocumentItem,
  LoginResult,
  ProfileResult,
  ContextResult,
  SearchResult,
  SkillMatch,
  SseEvent,
} from './schemas.js';

export interface ApiClientOptions {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class RagApiClient {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ApiClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async login(input: { username: string; password: string }): Promise<LoginResult> {
    return this.request<LoginResult>('/auth/login', {
      method: 'POST',
      body: input,
      auth: false,
    });
  }

  async profile(): Promise<ProfileResult> {
    return this.request<ProfileResult>('/auth/profile');
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
      if (error instanceof CliError && error.code === 'not_found') {
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

  async *streamChat(input: {
    query: string;
    mode: ChatMode;
    threadId?: string;
  }): AsyncGenerator<SseEvent> {
    if (!this.options.token) {
      throw new CliError('unauthorized', 'missing token, please run rag auth login', {
        recoverable: true,
      });
    }

    const params = new URLSearchParams({
      query: input.query,
      mode: input.mode,
    });
    if (input.threadId) {
      params.set('threadId', input.threadId);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        `${this.options.baseUrl}/chat/stream?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${this.options.token}`,
          },
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const payload = await safeReadErrorPayload(response);
        throw httpError(response.status, payload);
      }
      if (!response.body) {
        throw new CliError('server_error', 'stream response body is empty');
      }

      let buffer = '';
      const decoder = new TextDecoder();
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const event = parseSseEvent(part);
          if (event) {
            yield event;
          }
        }
      }
      buffer += decoder.decode();
      const tail = parseSseEvent(buffer);
      if (tail) {
        yield tail;
      }
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CliError('service_unavailable', `request timeout after ${this.timeoutMs}ms`, {
          recoverable: true,
        });
      }
      if (error instanceof TypeError) {
        throw new CliError('service_unavailable', `service unavailable: ${error.message}`, {
          recoverable: true,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async adminSearch(kind: 'popular' | 'no-result' | 'recall-issues'): Promise<unknown> {
    const pathByKind = {
      popular: '/rag/admin/search/queries/popular',
      'no-result': '/rag/admin/search/queries/no-result',
      'recall-issues': '/rag/admin/search/recall-issues',
    } as const;
    return this.request<unknown>(pathByKind[kind]);
  }

  async evalStatus(): Promise<unknown> {
    return this.request<unknown>('/rag/admin/evaluations');
  }

  async evalRun(input: { dataset?: string; mode?: string }): Promise<unknown> {
    return this.request<unknown>('/rag/admin/evaluations/run', {
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

  async listSkills(): Promise<SkillMatch[]> {
    return this.request<SkillMatch[]>('/skills');
  }

  async matchSkills(query: string, limit: number): Promise<SkillMatch[]> {
    const params = new URLSearchParams({ query, limit: String(limit) });
    return this.request<SkillMatch[]>(`/skills/match?${params.toString()}`);
  }

  async listDocuments(): Promise<DocumentItem[]> {
    return this.request<DocumentItem[]>('/documents');
  }

  async getDocument(docId: string): Promise<DocumentItem> {
    return this.request<DocumentItem>(`/documents/${encodeURIComponent(docId)}`);
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
    if (auth && !this.options.token) {
      throw new CliError('unauthorized', 'missing token, please run rag auth login', {
        recoverable: true,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (auth && this.options.token) {
      headers.Authorization = `Bearer ${this.options.token}`;
    }

    try {
      const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });

      const contentType = response.headers.get('content-type') ?? '';
      const payload = contentType.includes('application/json')
        ? ((await response.json()) as unknown)
        : await response.text();

      if (!response.ok) {
        throw httpError(response.status, payload);
      }

      return unwrapResponse<T>(payload);
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CliError('service_unavailable', `request timeout after ${this.timeoutMs}ms`, {
          recoverable: true,
        });
      }
      if (error instanceof TypeError) {
        throw new CliError('service_unavailable', `service unavailable: ${error.message}`, {
          recoverable: true,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function safeReadErrorPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

function parseSseEvent(raw: string): SseEvent | null {
  const lines = raw.split(/\r?\n/);
  let eventType: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  if (dataLines.length === 0 && !eventType) {
    return null;
  }

  const dataText = dataLines.join('\n');
  let data: unknown = dataText;
  if (dataText) {
    try {
      data = JSON.parse(dataText);
    } catch {
      data = dataText;
    }
  }
  const inferredType =
    eventType ?? (data && typeof data === 'object' && 'type' in data ? String((data as { type: unknown }).type) : undefined);

  return {
    type: inferredType,
    data,
  };
}

function unwrapResponse<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === 'object' &&
    'code' in payload &&
    'data' in payload
  ) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function httpError(status: number, payload: unknown): CliError {
  const message = extractMessage(payload) ?? `HTTP ${status}`;
  if (status === 401) {
    return new CliError('unauthorized', message, { recoverable: true, details: payload });
  }
  if (status === 403) {
    return new CliError('forbidden', message, { recoverable: false, details: payload });
  }
  if (status === 404) {
    return new CliError('not_found', message, { recoverable: true, details: payload });
  }
  return new CliError('server_error', message, { recoverable: false, details: payload });
}

function extractMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return typeof payload === 'string' ? payload : undefined;
  }
  const record = payload as Record<string, unknown>;
  const message = record.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join(', ');
  return undefined;
}
