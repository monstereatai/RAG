import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis Provider
 *
 * 提供基础的 KV 缓存读写与删除能力。
 * 若连接失败或未配置 Redis，会自动禁用，不阻断系统启动。
 */
@Injectable()
export class RedisProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisProvider.name);
  private client!: Redis;
  private enabled = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('redis.url');
    if (!url) {
      this.logger.warn('Redis URL is not configured. Redis cache is disabled.');
      return;
    }

    try {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
        retryStrategy(times) {
          if (times > 3) {
            return null; // 停止重试，防止阻塞
          }
          return Math.min(times * 100, 2000);
        },
      });

      this.client.on('connect', () => {
        this.enabled = true;
        this.logger.log(`Redis connected successfully.`);
      });

      this.client.on('error', (err) => {
        this.logger.warn(`Redis connection error: ${err.message}`);
        this.enabled = false;
      });
    } catch (err) {
      this.logger.warn(
        `Redis initialization failed: ${(err as Error).message}`,
      );
      this.enabled = false;
    }
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.disconnect();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 读取缓存
   */
  async get(key: string): Promise<string | null> {
    if (!this.enabled) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      this.logger.warn(
        `Redis GET failed for key=${key}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 写入缓存（支持 TTL 过期时间）
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.enabled) return;
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err) {
      this.logger.warn(
        `Redis SET failed for key=${key}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * 删除缓存
   */
  async del(key: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.warn(
        `Redis DEL failed for key=${key}: ${(err as Error).message}`,
      );
    }
  }

  async zrange(
    key: string,
    start: number,
    stop: number,
    direction?: 'REV',
  ): Promise<string[]> {
    if (!this.enabled) return [];
    try {
      if (direction === 'REV') {
        return await this.client.zrange(key, start, stop, 'REV');
      }
      return await this.client.zrange(key, start, stop);
    } catch (err) {
      this.logger.warn(
        `Redis ZRANGE failed for key=${key}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.client.zadd(key, score, member);
    } catch (err) {
      this.logger.warn(
        `Redis ZADD failed for key=${key}: ${(err as Error).message}`,
      );
    }
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this.enabled) return [];
    try {
      return await this.client.keys(pattern);
    } catch (err) {
      this.logger.warn(
        `Redis KEYS failed for pattern=${pattern}: ${(err as Error).message}`,
      );
      return [];
    }
  }
}
