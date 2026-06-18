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

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const enabled = this.configService.get<boolean>('mem0.enabled', false);
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
        const result = await this.cloudClient.search(query, { filters, topK });
        return (result.results ?? []).map((m) => ({
          id: m.id,
          memory: m.memory ?? '',
          score: m.score,
          metadata: m.metadata,
        }));
      }

      // local mode
      const filters = runId
        ? { AND: [{ user_id: userId }, { run_id: runId }] }
        : { user_id: userId };
      const result = await this.localRequest('/search', {
        method: 'POST',
        body: JSON.stringify({ query, filters, top_k: topK }),
      });
      const results = (result.results as Record<string, unknown>[] | undefined) ?? [];
      return results.map((m) => ({
        id: m.id as string,
        memory: (m.memory as string) ?? '',
        score: m.score as number | undefined,
        metadata: m.metadata as Record<string, unknown> | undefined,
      }));
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

    const { messages, userId, runId } = params;

    try {
      if (this.cloudClient) {
        await this.cloudClient.add(messages, {
          userId,
          ...(runId ? { runId } : {}),
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
        }),
      });
    } catch (err) {
      this.logger.error(`Mem0 add failed: ${(err as Error).message}`);
    }
  }

  /**
   * 列出用户所有记忆
   */
  async getAll(userId: string): Promise<Mem0MemoryResult[]> {
    if (!this._isEnabled) return [];

    try {
      if (this.cloudClient) {
        const result = await this.cloudClient.getAll({
          filters: { user_id: userId },
          pageSize: 50,
        });
        return (result.results ?? []).map((m) => ({
          id: m.id,
          memory: m.memory ?? '',
          score: m.score,
          metadata: m.metadata,
        }));
      }

      // local mode
      const result = await this.localRequest(
        `/memories?user_id=${encodeURIComponent(userId)}`,
      );
      const items =
        (result.results as Record<string, unknown>[] | undefined) ??
        (Array.isArray(result) ? (result as Record<string, unknown>[]) : []);
      return items.map((m) => ({
        id: m.id as string,
        memory: (m.memory as string) ?? '',
        score: m.score as number | undefined,
        metadata: m.metadata as Record<string, unknown> | undefined,
      }));
    } catch (err) {
      this.logger.error(`Mem0 getAll failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * 删除用户所有记忆
   */
  async deleteAll(userId: string): Promise<void> {
    if (!this._isEnabled) return;

    try {
      if (this.cloudClient) {
        await this.cloudClient.deleteAll({ userId });
        return;
      }

      // local mode
      await this.localRequest(
        `/memories?user_id=${encodeURIComponent(userId)}`,
        {
          method: 'DELETE',
        },
      );
    } catch (err) {
      this.logger.error(`Mem0 deleteAll failed: ${(err as Error).message}`);
    }
  }

  // --- private helpers ---

  private async localRequest(
    path: string,
    options: RequestInit = {},
  ): Promise<any> {
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
          ? String((body as Record<string, unknown>).detail ?? JSON.stringify(body))
          : String(body ?? '');
      throw new Error(`${res.status} ${detail}`);
    }

    return body;
  }
}
