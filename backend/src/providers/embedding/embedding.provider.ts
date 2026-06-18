import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { IEmbeddingProvider } from './embedding-provider.interface';
import { QwenEmbeddingProvider } from './qwen-embedding.provider';
import { RedisProvider } from '../redis/redis.provider';

/**
 * Embedding Provider 工厂 + Caching 代理
 * 按 config.embedding.provider 注入对应实现，自动代理并使用 Redis 对 Embedding 结果进行缓存以防重复计算和 API 收费。
 */
@Injectable()
export class EmbeddingProvider implements IEmbeddingProvider, OnModuleInit {
  private provider!: IEmbeddingProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly qwenProvider: QwenEmbeddingProvider,
    private readonly redisProvider: RedisProvider,
  ) {}

  onModuleInit() {
    const providerName =
      this.config.get<string>('embedding.provider') ?? 'qwen';
    switch (providerName) {
      case 'qwen':
        this.provider = this.qwenProvider;
        break;
      default:
        throw new Error(`Unsupported embedding provider: ${providerName}`);
    }
  }

  /**
   * 辅助：生成字符串 hash 值
   */
  private hashText(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  /**
   * 向量化查询（支持 Redis 缓存，TTL 7 天）
   */
  async embedQuery(text: string): Promise<number[]> {
    const key = `emb:q:${this.hashText(text)}`;

    if (this.redisProvider.isEnabled()) {
      const cached = await this.redisProvider.get(key);
      if (cached) {
        try {
          return JSON.parse(cached) as number[];
        } catch {
          // ignore parse error, fetch fresh
        }
      }
    }

    const vector = await this.provider.embedQuery(text);

    if (this.redisProvider.isEnabled()) {
      await this.redisProvider.set(key, JSON.stringify(vector), 7 * 24 * 3600); // 7 天
    }

    return vector;
  }

  /**
   * 批量向量化文档分片（支持分片级缓存，新分片写入缓存，TTL 7 天）
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = new Array<number[]>(texts.length);
    const misses: Array<{ index: number; text: string }> = [];

    // 1. 尝试在 Redis 中批量查找已存在的缓存分片
    for (const [i, text] of texts.entries()) {
      const key = `emb:d:${this.hashText(text)}`;
      let cachedVector: number[] | null = null;

      if (this.redisProvider.isEnabled()) {
        const cached = await this.redisProvider.get(key);
        if (cached) {
          try {
            cachedVector = JSON.parse(cached) as number[];
          } catch {
            // ignore
          }
        }
      }

      if (cachedVector) {
        results[i] = cachedVector;
      } else {
        misses.push({ index: i, text });
      }
    }

    // 2. 对于没有命中缓存的，调用 API 获取向量，并写入缓存中
    if (misses.length > 0) {
      const missTexts = misses.map((m) => m.text);
      const vectors = await this.provider.embedDocuments(missTexts);

      for (const [i, vector] of vectors.entries()) {
        const miss = misses[i];
        results[miss.index] = vector;

        if (this.redisProvider.isEnabled()) {
          const key = `emb:d:${this.hashText(miss.text)}`;
          await this.redisProvider.set(
            key,
            JSON.stringify(vector),
            7 * 24 * 3600, // 7 天
          );
        }
      }
    }

    return results;
  }
}
