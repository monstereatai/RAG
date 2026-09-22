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

  /** 读取持久化状态的严格版本；命令失败不能被伪装成“没有数据”。 */
  async getRequired(key: string): Promise<string | null> {
    if (!this.enabled) throw new Error('Redis is unavailable');
    try {
      return await this.client.get(key);
    } catch (err) {
      this.enabled = false;
      throw err;
    }
  }

  async setRequiredOrThrow(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<void> {
    if (!this.enabled) throw new Error('Redis is unavailable');
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err) {
      this.enabled = false;
      throw err;
    }
  }

  async zrangeRequired(
    key: string,
    start: number,
    stop: number,
    direction?: 'REV',
  ): Promise<string[]> {
    if (!this.enabled) throw new Error('Redis is unavailable');
    try {
      return direction === 'REV'
        ? await this.client.zrange(key, start, stop, 'REV')
        : await this.client.zrange(key, start, stop);
    } catch (err) {
      this.enabled = false;
      throw err;
    }
  }

  async zaddRequired(key: string, score: number, member: string): Promise<void> {
    if (!this.enabled) throw new Error('Redis is unavailable');
    try {
      await this.client.zadd(key, score, member);
    } catch (err) {
      this.enabled = false;
      throw err;
    }
  }

  async delRequired(key: string): Promise<void> {
    if (!this.enabled) throw new Error('Redis is unavailable');
    try {
      await this.client.del(key);
    } catch (err) {
      this.enabled = false;
      throw err;
    }
  }

  async keysRequired(pattern: string): Promise<string[]> {
    if (!this.enabled) throw new Error('Redis is unavailable');
    try {
      return await this.client.keys(pattern);
    } catch (err) {
      this.enabled = false;
      throw err;
    }
  }

  /**
   * 读取并删除（GETDEL，Redis >= 6.2），用于激活 token / 验证码等
   * 「一次性消费」场景：读取即删除，避免二次使用。
   * 服务端版本过低不支持 GETDEL 时使用 Lua 原子读删；不能降级为分离的
   * GET + DEL，否则并发请求可能重复消费一次性 token。Redis 不可用返回 null，
   * 由调用方按「token 不存在」处理。
   */
  async getdel(key: string): Promise<string | null> {
    if (!this.enabled) return null;
    try {
      return await this.client.getdel(key);
    } catch (err) {
      this.logger.warn(
        `Redis GETDEL failed for key=${key}: ${(err as Error).message}`,
      );
      try {
        return (await this.client.eval(
          "local value = redis.call('get', KEYS[1]); if value then redis.call('del', KEYS[1]); end; return value",
          1,
          key,
        )) as string | null;
      } catch (fallbackErr) {
        this.logger.warn(
          `Redis GET+DEL fallback failed for key=${key}: ${(fallbackErr as Error).message}`,
        );
        return null;
      }
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
   * 写入一个安全边界要求必须成功的 key。
   * 普通缓存可以容忍 Redis 故障，但一次性票据和幂等完成标记不能在
   * “调用已经发生、结果却没有落盘”时继续宣称成功。
   */
  async setRequired(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
      return true;
    } catch (err) {
      this.logger.warn(
        `Redis required SET failed for key=${key}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Redis 原子固定窗口计数。用于租户级限流与成本预算，返回当前计数和窗口剩余毫秒数。
   * Redis 不可用时返回 null，由上层按生产 fail-closed／开发降级策略处理。
   */
  async incrementWindow(
    key: string,
    ttlMs: number,
    amount = 1,
  ): Promise<{ value: number; ttlMs: number } | null> {
    if (!this.enabled) return null;
    try {
      const result = (await this.client.eval(
        "local value = redis.call('incrby', KEYS[1], ARGV[1]); if value == tonumber(ARGV[1]) then redis.call('pexpire', KEYS[1], ARGV[2]); end; return {value, redis.call('pttl', KEYS[1])}",
        1,
        key,
        String(amount),
        String(Math.max(1, Math.trunc(ttlMs))),
      )) as [number | string, number | string];
      return { value: Number(result[0]), ttlMs: Number(result[1]) };
    } catch (err) {
      this.logger.warn(
        `Redis INCR window failed for key=${key}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 在固定窗口内原子预留额度。超出 limit 时不修改计数，避免“拒绝请求仍消耗预算”。
   * Redis 不可用返回 null，由上层按生产 fail-closed／开发降级策略处理。
   */
  async reserveWindow(
    key: string,
    ttlMs: number,
    amount: number,
    limit: number,
  ): Promise<{ allowed: boolean; value: number; ttlMs: number } | null> {
    if (!this.enabled) return null;
    try {
      const result = (await this.client.eval(
        "local current = tonumber(redis.call('get', KEYS[1]) or '0'); local amount = tonumber(ARGV[1]); local limit = tonumber(ARGV[2]); local ttl = redis.call('pttl', KEYS[1]); if current + amount > limit then return {0, current, ttl}; end; local value = redis.call('incrby', KEYS[1], ARGV[1]); if current == 0 then redis.call('pexpire', KEYS[1], ARGV[3]); ttl = tonumber(ARGV[3]); else ttl = redis.call('pttl', KEYS[1]); end; return {1, value, ttl}",
        1,
        key,
        String(Math.max(1, Math.trunc(amount))),
        String(Math.max(0, Math.trunc(limit))),
        String(Math.max(1, Math.trunc(ttlMs))),
      )) as [number | string, number | string, number | string];
      return {
        allowed: Number(result[0]) === 1,
        value: Number(result[1]),
        ttlMs: Number(result[2]),
      };
    } catch (err) {
      this.logger.warn(
        `Redis RESERVE window failed for key=${key}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 仅在 key 不存在时写入，用于工具调用的幂等执行锁。
   * Redis 不可用时返回 false，由调用方按保守的本进程策略继续处理。
   */
  async setIfAbsent(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (err) {
      this.logger.warn(
        `Redis SET NX failed for key=${key}: ${(err as Error).message}`,
      );
      return false;
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

  /** 仅删除自己持有的锁，避免租约过期后误删其他实例的新锁。 */
  async releaseLock(key: string, value: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.client.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
        1,
        key,
        value,
      );
    } catch (err) {
      this.logger.warn(
        `Redis release lock failed for key=${key}: ${(err as Error).message}`,
      );
    }
  }

  /** 仅在仍由当前实例持有时续租，避免长任务超过租约后被另一实例并行推进。 */
  async renewLock(
    key: string,
    value: string,
    seconds: number,
  ): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const result = await this.client.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end',
        1,
        key,
        value,
        String(seconds),
      );
      return Number(result) === 1;
    } catch (err) {
      this.logger.warn(
        `Redis renew lock failed for key=${key}: ${(err as Error).message}`,
      );
      return false;
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

  /**
   * 设置 key 过期时间（秒）
   */
  async expire(key: string, seconds: number): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.client.expire(key, seconds);
    } catch (err) {
      this.logger.warn(
        `Redis EXPIRE failed for key=${key}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * 删除并返回有序集合中指定排名范围的成员
   */
  async zremrangebyrank(
    key: string,
    start: number,
    stop: number,
  ): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.client.zremrangebyrank(key, start, stop);
    } catch (err) {
      this.logger.warn(
        `Redis ZREMRANGEBYRANK failed for key=${key}: ${(err as Error).message}`,
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

  /**
   * 使用 SCAN 分批遍历键，避免在生产 Redis 上执行阻塞性的 KEYS。
   */
  async scan(pattern: string): Promise<string[]> {
    if (!this.enabled) return [];
    try {
      const matched: string[] = [];
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          500,
        );
        cursor = nextCursor;
        matched.push(...keys);
      } while (cursor !== '0');
      return matched;
    } catch (err) {
      this.logger.warn(
        `Redis SCAN failed for pattern=${pattern}: ${(err as Error).message}`,
      );
      return [];
    }
  }
}
