import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisProvider } from '../../providers/redis/redis.provider';
import type { JwtPayload } from '../interfaces/api-response.interface';

type Counter = { value: number; expiresAt: number };

/**
 * 租户／用户级固定窗口治理。
 *
 * 生产优先使用 Redis 原子计数，避免多实例各自限流；开发环境 Redis 不可用时
 * 只保留进程内保护，不能把该降级路径当作生产配额。
 */
@Injectable()
export class TenantQuotaGuard implements CanActivate {
  private readonly localCounters = new Map<string, Counter>();

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.config.get<boolean>('tenantQuota.enabled') !== true) return true;
    const request = context.switchToHttp().getRequest<Record<string, any>>();
    const user = request.user as JwtPayload | undefined;
    const scope = user?.tenantId?.trim()
      ? `tenant:${user.tenantId.trim()}`
      : user?.userId
        ? `user:${user.userId}`
        : `ip:${String(request.ip ?? 'unknown')}`;
    const windowMs = this.bound(
      this.config.get<number>('tenantQuota.windowMs') ?? 60_000,
      1_000,
      86_400_000,
    );
    const requestLimit = this.bound(
      this.config.get<number>('tenantQuota.requestLimit') ?? 60,
      1,
      1_000_000,
    );
    const requestCount = await this.reserve(
      `rag:quota:req:${scope}:${Math.floor(Date.now() / windowMs)}`,
      windowMs,
      1,
      requestLimit,
    );
    if (!requestCount.allowed) {
      throw new HttpException(
        'tenant request quota exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const dailyBudgetCents = this.bound(
      Math.round(
        (this.config.get<number>('tenantQuota.dailyBudgetUsd') ?? 0) * 100,
      ),
      0,
      100_000_000,
    );
    if (dailyBudgetCents > 0) {
      const estimatedCostCents = this.bound(
        Math.round(
          (this.config.get<number>('tenantQuota.estimatedCostPerRequestUsd') ??
            0.02) * 100,
        ),
        1,
        dailyBudgetCents,
      );
      const cost = await this.reserve(
        `rag:quota:cost:${scope}:${new Date().toISOString().slice(0, 10)}`,
        86_400_000,
        estimatedCostCents,
        dailyBudgetCents,
      );
      if (!cost.allowed) {
        throw new HttpException(
          'tenant daily AI budget exceeded',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }

  private async reserve(
    key: string,
    ttlMs: number,
    amount: number,
    limit: number,
  ): Promise<{ allowed: boolean; value: number; ttlMs: number }> {
    const shared = await this.redis.reserveWindow(key, ttlMs, amount, limit);
    if (shared) return shared;
    if (this.config.get<boolean>('tenantQuota.requireDistributed') === true) {
      throw new ServiceUnavailableException(
        'distributed tenant quota store is unavailable',
      );
    }
    const now = Date.now();
    const current = this.localCounters.get(key);
    if (!current || current.expiresAt <= now) {
      if (amount > limit) {
        return { allowed: false, value: 0, ttlMs };
      }
      this.localCounters.set(key, { value: amount, expiresAt: now + ttlMs });
      return { allowed: true, value: amount, ttlMs };
    }
    if (current.value + amount > limit) {
      return {
        allowed: false,
        value: current.value,
        ttlMs: Math.max(0, current.expiresAt - now),
      };
    }
    current.value += amount;
    return {
      allowed: true,
      value: current.value,
      ttlMs: Math.max(0, current.expiresAt - now),
    };
  }

  private bound(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  }
}
