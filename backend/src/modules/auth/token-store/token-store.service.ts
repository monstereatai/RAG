import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisProvider } from '../../../providers/redis/redis.provider';
import type { TokenStore } from './token-store.interface';
import { InMemoryTokenStore } from './in-memory.token-store';
import { RedisTokenStore } from './redis.token-store';

/**
 * TokenStore 门面（策略切换）
 *
 * - Redis 可用（RedisProvider.isEnabled()）→ RedisTokenStore（多实例共享）；
 * - Redis 未配置 / 连接失败 → 开发环境降级为进程内 InMemoryTokenStore，并输出
 *   warn 日志（重启即丢）；生产环境由 `auth.requireDistributedTokenStore` fail-closed。
 *   Redis 恢复后自动切回。
 *
 * 按操作动态选择后端：RedisProvider 的 enabled 标志会在连接/断开时翻转，
 * 因此单次 Redis 故障不会永久钉死在内存实现上。
 *
 * 该类同时是冒烟测试的注入点：不注入 RedisProvider 即得到纯内存实现。
 */
@Injectable()
export class TokenStoreService implements TokenStore {
  private readonly logger = new Logger(TokenStoreService.name);
  private readonly memoryStore = new InMemoryTokenStore();
  private redisStore: RedisTokenStore | null = null;
  private fallbackWarned = false;

  constructor(
    @Optional() private readonly redisProvider?: RedisProvider,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    return this.store.set(key, value, ttlSeconds);
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key);
  }

  async delete(key: string): Promise<void> {
    return this.store.delete(key);
  }

  async consume(key: string): Promise<string | null> {
    return this.store.consume(key);
  }

  /** 按当前 Redis 健康状态选择后端 */
  private get store(): TokenStore {
    if (this.redisProvider?.isEnabled()) {
      this.fallbackWarned = false;
      return (this.redisStore ??= new RedisTokenStore(this.redisProvider));
    }
    if (this.configService?.get<boolean>('auth.requireDistributedTokenStore')) {
      throw new ServiceUnavailableException(
        'distributed token store is required but Redis is unavailable',
      );
    }
    this.warnFallback();
    return this.memoryStore;
  }

  /** 降级 warn 只在状态切换时输出一次，避免刷屏 */
  private warnFallback(): void {
    if (this.fallbackWarned) {
      return;
    }
    this.fallbackWarned = true;
    this.logger.warn(
      'Redis 不可用，激活/重置 token 降级为进程内存存储（重启后丢失，仅建议本地/演示环境使用）',
    );
  }
}
