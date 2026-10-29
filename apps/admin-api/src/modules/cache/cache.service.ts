import { Injectable, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { Redis } from 'ioredis';

@Injectable()
export class CacheService implements OnModuleInit {
  private redis?: Redis;
  private localCache: Cache;
  private readonly redisEnabled = process.env.ENABLE_REDIS === 'true';

  constructor(
    @Inject('CACHE_MANAGER') private cacheManager: Cache,
    private readonly configService: ConfigService
  ) {}

  onModuleInit() {
    this.localCache = this.cacheManager;

    if (!this.redisEnabled) {
      return;
    }

    // 初始化Redis连接
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: this.configService.get<number>('REDIS_DB', 0),
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    this.redis.on('error', (error) => {
      console.error('Redis error:', error);
    });

    this.redis.on('connect', () => {
      console.log('Connected to Redis');
    });

  }

  // 缓存预热
  async warmUp() {
    const cacheKeys = [
      'system:version',
      'system:config',
      'app:statistics',
    ];

    for (const key of cacheKeys) {
      await this.set(key, this.getDefaultValue(key), 3600);
    }
  }

  // 获取缓存（优先使用Redis，失败时降级到本地缓存）
  async get(key: string): Promise<any> {
    try {
      const value = await this.redis?.get(key);
      if (value) {
        return JSON.parse(value);
      }
    } catch (error) {
      console.warn('Redis get failed, falling back to local cache:', error);
    }

    // 降级到本地缓存
    return await this.localCache.get(key);
  }

  // 设置缓存（Redis + 本地缓存）
  async set(key: string, value: any, ttl: number = 3600): Promise<void> {
    try {
      await this.redis?.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (error) {
      console.warn('Redis set failed, falling back to local cache:', error);
    }

    // 同时设置本地缓存
    await this.localCache.set(key, value, ttl);
  }

  // 删除缓存
  async del(key: string): Promise<void> {
    try {
      await this.redis?.del(key);
    } catch (error) {
      console.warn('Redis del failed:', error);
    }

    // 删除本地缓存
    await this.localCache.del(key);
  }

  // 批量删除缓存
  async delByPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis?.keys(pattern) || [];
      if (keys.length > 0) {
        await this.redis?.del(...keys);
      }
    } catch (error) {
      console.warn('Redis delByPattern failed:', error);
    }
  }

  // 缓存统计
  async getStats() {
    try {
      if (!this.redis) {
        return {
          redis: { connected: false },
          local: {},
        };
      }

      const info = await this.redis.info('memory');
      const memory = this.parseRedisInfo(info);
      const connected = await this.redis.ping() === 'PONG';

      return {
        redis: {
          connected,
          memoryUsage: memory.used_memory || 0,
          keyCount: await this.redis.dbsize(),
        },
        local: {
          ...await this.localCache.mget(['memory', 'hits', 'misses']),
        },
      };
    } catch (error) {
      console.error('Failed to get cache stats:', error);
      return {
        redis: { connected: false },
        local: {},
      };
    }
  }

  // 分布式锁
  async acquireLock(key: string, ttl: number = 30000): Promise<boolean> {
    const lockKey = `lock:${key}`;
    try {
      const result = await this.redis.set(lockKey, '1', 'PX', ttl, 'NX');
      return result === 'OK';
    } catch (error) {
      console.error('Failed to acquire lock:', error);
      return false;
    }
  }

  // 释放锁
  async releaseLock(key: string): Promise<void> {
    const lockKey = `lock:${key}`;
    try {
      await this.redis?.del(lockKey);
    } catch (error) {
      console.error('Failed to release lock:', error);
    }
  }

  // 带锁的缓存操作
  async lockAndGet(key: string, fetchFn: () => Promise<any>, ttl: number = 3600): Promise<any> {
    const lockKey = `lock:${key}`;
    const gotLock = await this.acquireLock(lockKey, 5000);

    try {
      if (gotLock) {
        const value = await fetchFn();
        await this.set(key, value, ttl);
        return value;
      } else {
        // 等待并重试
        await new Promise(resolve => setTimeout(resolve, 100));
        return await this.get(key);
      }
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  private parseRedisInfo(info: string) {
    const result: any = {};
    const lines = info.split('\n');

    for (const line of lines) {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        result[key] = value;
      }
    }

    return result;
  }

  private getDefaultValue(key: string): any {
    switch (key) {
      case 'system:version':
        return '1.0.0';
      case 'system:config':
        return {};
      case 'app:statistics':
        return {
          uptime: Date.now(),
          requests: 0,
          errors: 0,
        };
      default:
        return null;
    }
  }

  // 清理过期缓存
  async cleanup(): Promise<void> {
    try {
      // Redis会自动清理过期的key
      console.log('Cache cleanup completed');
    } catch (error) {
      console.error('Cache cleanup failed:', error);
    }
  }
}
