import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemoryClient } from 'mem0ai';

export interface Mem0SearchParams {
  query: string;
  userId: string;
  runId?: string;
  topK?: number;
}

export interface Mem0AddParams {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  userId: string;
  runId?: string;
  metadata?: Record<string, unknown>;
  infer?: boolean;
}

export interface Mem0MemoryResult {
  id: string;
  memory: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Mem0 长期记忆 Provider
 *
 * 支持三种模式：
 * - cloud: 使用 Mem0 云端 API（需要 MEM0_API_KEY）
 * - local: 使用本地部署的 Mem0 API（需要 MEM0_BASE_URL）
 * - disabled: 未配置时自动禁用，不阻断启动
 */
@Injectable()
export class Mem0Provider implements OnModuleInit {
  private readonly logger = new Logger(Mem0Provider.name);
  private cloudClient: MemoryClient | null = null;
  private localBaseUrl: string | null = null;
  private localApiKey: string | null = null;
  private _isEnabled = false;
  private _requested = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const enabled = this.configService.get<boolean>('mem0.enabled', false);
    this._requested = enabled;
    if (!enabled) {
      this.logger.log(
        'Mem0 is disabled (MEM0_ENABLED !== true). Long-term memory features disabled.',
      );
      return;
    }

    const provider = this.configService.get<string>('mem0.provider', 'cloud');
    const apiKey = this.configService.get<string>('mem0.apiKey', '');

    if (provider === 'cloud') {
      if (!apiKey) {
        this.logger.warn(
          'Mem0 cloud mode requires MEM0_API_KEY. Mem0 disabled.',
        );
        return;
      }
      this.cloudClient = new MemoryClient({ apiKey });
      this._isEnabled = true;
      this.logger.log('Mem0 cloud mode initialized successfully.');
    } else if (provider === 'local') {
      const baseUrl = this.configService.get<string>('mem0.baseUrl', '');
      if (!baseUrl) {
        this.logger.warn(
          'Mem0 local mode requires MEM0_BASE_URL. Mem0 disabled.',
        );
        return;
      }
      this.localBaseUrl = baseUrl.replace(/\/$/, '');
      this.localApiKey = apiKey || null;
      this._isEnabled = true;
      this.logger.log(`Mem0 local mode initialized: ${this.localBaseUrl}`);
    } else {
      this.logger.warn(`Unknown Mem0 provider: "${provider}". Mem0 disabled.`);
    }
  }

  isEnabled(): boolean {
    return this._isEnabled;
  }

  isRequested(): boolean {
    return this._requested;
  }

  /** Update metadata on one memory while keeping its history in Mem0. */
  async updateMetadata(
    memoryId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!this._isEnabled) return;

    const scopedMemoryId = memoryId.trim();
    if (!scopedMemoryId) {
      throw new Error('Mem0 metadata update requires memoryId.');
    }

    try {
      if (this.cloudClient) {
        await this.cloudClient.update(scopedMemoryId, { metadata });
        return;
      }

      await this.localRequest(
        `/memories/${encodeURIComponent(scopedMemoryId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ metadata }),
        },
      );
    } catch (err) {
      this.logger.error(
        `Mem0 metadata update failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * 搜索记忆
   */
  async search(params: Mem0SearchParams): Promise<Mem0MemoryResult[]> {
    if (!this._isEnabled) return [];

    const { query, userId, runId, topK = 5 } = params;

    try {
      if (this.cloudClient) {
        const filters = runId
          ? { AND: [{ user_id: userId }, { run_id: runId }] }
          : { user_id: userId };
        const result = await this.cloudClient.search(query, {
          filters,
          topK,
          latestOnly: true,
        });
        return (result.results ?? []).map((memory) =>
          this.toMemoryResult(memory as unknown as Record<string, unknown>),
        );
      }

      // local mode
      const filters = runId
        ? { AND: [{ user_id: userId }, { run_id: runId }] }
        : { user_id: userId };
      const result = await this.localRequest('/search', {
        method: 'POST',
        body: JSON.stringify({
          query,
          filters,
          top_k: topK,
        }),
      });
      const results =
        (result.results as Record<string, unknown>[] | undefined) ?? [];
      return results.map((memory) => this.toMemoryResult(memory));
    } catch (err) {
      this.logger.error(`Mem0 search failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * 添加记忆（异步处理，Mem0 内部会做事实抽取）
   */
  async add(params: Mem0AddParams): Promise<void> {
    if (!this._isEnabled) return;

    const { messages, userId, runId, metadata, infer } = params;

    try {
      if (this.cloudClient) {
        await this.cloudClient.add(messages, {
          userId,
          ...(runId ? { runId } : {}),
          ...(metadata ? { metadata } : {}),
          ...(infer === undefined ? {} : { infer }),
        });
        return;
      }

      // local mode
      await this.localRequest('/memories', {
        method: 'POST',
        body: JSON.stringify({
          messages,
          user_id: userId,
          run_id: runId,
          ...(metadata ? { metadata } : {}),
          ...(infer === undefined ? {} : { infer }),
        }),
      });
    } catch (err) {
      this.logger.error(`Mem0 add failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * 列出用户所有记忆
   * latestOnly=false 包含已被替代的记忆，供 Outbox 重放查重。
   * failOnError=true 时保留服务错误，避免把查询失败当作“尚未写入”。
   */
  async getAll(
    userId: string,
    runId?: string,
    latestOnly = true,
    failOnError = false,
  ): Promise<Mem0MemoryResult[]> {
    if (!this._isEnabled) return [];

    try {
      const filters = runId
        ? { AND: [{ user_id: userId }, { run_id: runId }] }
        : { user_id: userId };
      if (this.cloudClient) {
        const memories: Awaited<ReturnType<MemoryClient['getAll']>>['results'] =
          [];
        let page = 1;
        let hasNextPage = true;

        while (hasNextPage) {
          const result = await this.cloudClient.getAll({
            filters,
            page,
            pageSize: 50,
            latestOnly,
          });
          const pageMemories = result.results ?? [];
          memories.push(...pageMemories);
          hasNextPage = Boolean(result.next) && pageMemories.length > 0;
          page += 1;
        }

        return memories.map((memory) =>
          this.toMemoryResult(memory as unknown as Record<string, unknown>),
        );
      }

      // local mode
      const params = new URLSearchParams({
        user_id: userId,
      });
      if (runId) params.set('run_id', runId);
      const result = await this.localRequest(`/memories?${params.toString()}`);
      const items =
        (result.results as Record<string, unknown>[] | undefined) ??
        (Array.isArray(result) ? (result as Record<string, unknown>[]) : []);
      return items.map((memory) => this.toMemoryResult(memory));
    } catch (err) {
      this.logger.error(`Mem0 getAll failed: ${(err as Error).message}`);
      if (failOnError) throw err;
      return [];
    }
  }

  /**
   * 删除用户所有记忆
   */
  async deleteAll(userId: string): Promise<void> {
    if (!this._isEnabled) return;

    if (this.cloudClient) {
      await this.cloudClient.deleteAll({ userId });
      return;
    }

    // local mode
    await this.localRequest(`/memories?user_id=${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
  }

  /**
   * 删除指定用户在指定会话（run）下的记忆，保留该用户其他会话和长期记忆。
   */
  async deleteByRunId(userId: string, runId: string): Promise<void> {
    if (!this._isEnabled) return;

    const scopedUserId = userId.trim();
    const scopedRunId = runId.trim();
    if (!scopedUserId || !scopedRunId) {
      throw new Error('Mem0 session delete requires userId and runId.');
    }

    if (this.cloudClient) {
      await this.cloudClient.deleteAll({
        userId: scopedUserId,
        runId: scopedRunId,
      });
      return;
    }

    const params = new URLSearchParams({
      user_id: scopedUserId,
      run_id: scopedRunId,
    });
    await this.localRequest(`/memories?${params.toString()}`, {
      method: 'DELETE',
    });
  }

  // --- private helpers ---

  private toMemoryResult(memory: Record<string, unknown>): Mem0MemoryResult {
    const metadata =
      memory.metadata &&
      typeof memory.metadata === 'object' &&
      !Array.isArray(memory.metadata)
        ? (memory.metadata as Record<string, unknown>)
        : undefined;
    const runId = memory.run_id ?? memory.runId;
    const expirationDate = memory.expiration_date ?? memory.expirationDate;
    const validUntil =
      typeof expirationDate === 'string' ? expirationDate.slice(0, 10) : null;
    const normalizedMetadata =
      metadata || typeof runId === 'string' || validUntil
        ? {
            ...(metadata ?? {}),
            ...(typeof runId === 'string' && metadata?.run_id === undefined
              ? { run_id: runId }
              : {}),
            ...(validUntil && metadata?.rag_valid_until === undefined
              ? { rag_valid_until: validUntil }
              : {}),
          }
        : undefined;

    return {
      id: typeof memory.id === 'string' ? memory.id : '',
      memory: typeof memory.memory === 'string' ? memory.memory : '',
      score: typeof memory.score === 'number' ? memory.score : undefined,
      metadata: normalizedMetadata,
    };
  }

  private async localRequest(
    path: string,
    options: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.localApiKey) {
      headers['X-API-Key'] = this.localApiKey;
    }

    const res = await fetch(`${this.localBaseUrl}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers ?? {}),
      },
    });

    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!res.ok) {
      const detail =
        typeof body === 'object' && body !== null
          ? JSON.stringify((body as Record<string, unknown>).detail ?? body)
          : typeof body === 'string'
            ? body
            : JSON.stringify(body ?? null);
      throw new Error(`${res.status} ${detail}`);
    }

    return (typeof body === 'object' && body !== null ? body : {}) as Record<
      string,
      unknown
    >;
  }
}
