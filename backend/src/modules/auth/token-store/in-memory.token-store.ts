import type { TokenStore } from './token-store.interface';

interface MemoryEntry {
  value: string;
  /** 过期时间戳（ms）；无 TTL 时为 Infinity */
  expiresAt: number;
}

/**
 * 进程内存 TokenStore 实现
 *
 * 作为 Redis 不可用时的降级实现（以及冒烟测试注入点）：
 * - 过期清理：读取时惰性校验 + 写入时全量清扫，避免依赖定时器；
 * - 仅进程内有效，重启即丢——这正是降级语义的预期行为。
 */
export class InMemoryTokenStore implements TokenStore {
  private readonly entries = new Map<string, MemoryEntry>();

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.sweepExpired();
    this.entries.set(key, {
      value,
      expiresAt:
        ttlSeconds > 0
          ? Date.now() + ttlSeconds * 1000
          : Number.POSITIVE_INFINITY,
    });
    return Promise.resolve();
  }

  get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) {
      return Promise.resolve(null);
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  async consume(key: string): Promise<string | null> {
    const value = await this.get(key);
    if (value !== null) {
      this.entries.delete(key);
    }
    return value;
  }

  /** 清扫已过期条目，防止长期运行时内存膨胀 */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}
