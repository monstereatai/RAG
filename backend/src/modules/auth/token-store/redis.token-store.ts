import { RedisProvider } from '../../../providers/redis/redis.provider';
import type { TokenStore } from './token-store.interface';

/**
 * Redis TokenStore 实现
 *
 * 依赖 RedisProvider 的容错能力（连接失败返回 null / 静默跳过），
 * consume 使用原子 GETDEL（老版本 Redis 自动降级 GET+DEL），
 * 保证「读取即删除」的一次性语义。
 */
export class RedisTokenStore implements TokenStore {
  constructor(private readonly redis: RedisProvider) {}

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, ttlSeconds);
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async consume(key: string): Promise<string | null> {
    return this.redis.getdel(key);
  }
}
