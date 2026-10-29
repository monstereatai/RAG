import { HttpException } from '@nestjs/common';
import { TenantQuotaGuard } from './tenant-quota.guard';

describe('TenantQuotaGuard', () => {
  const context = (user: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user, ip: '127.0.0.1' }),
      }),
    }) as never;

  it('limits a tenant in a shared-counter compatible configuration', async () => {
    const config = {
      get: jest.fn((key: string) =>
        ({
          'tenantQuota.enabled': true,
          'tenantQuota.requireDistributed': false,
          'tenantQuota.windowMs': 60_000,
          'tenantQuota.requestLimit': 1,
          'tenantQuota.dailyBudgetUsd': 0,
        })[key],
      ),
    };
    const redis = {
      reserveWindow: jest.fn().mockResolvedValue(null),
    };
    const guard = new TenantQuotaGuard(config as never, redis as never);

    await expect(guard.canActivate(context({ tenantId: 'tenant-a' }))).resolves.toBe(
      true,
    );
    await expect(
      guard.canActivate(context({ tenantId: 'tenant-a' })),
    ).rejects.toBeInstanceOf(HttpException);
    expect(redis.reserveWindow).toHaveBeenCalledWith(
      expect.stringContaining('rag:quota:req:tenant:tenant-a:'),
      60_000,
      1,
      1,
    );
  });

  it('fails closed when distributed quota storage is required', async () => {
    const config = {
      get: jest.fn((key: string) =>
        ({
          'tenantQuota.enabled': true,
          'tenantQuota.requireDistributed': true,
          'tenantQuota.windowMs': 60_000,
          'tenantQuota.requestLimit': 60,
        })[key],
      ),
    };
    const guard = new TenantQuotaGuard(
      config as never,
      { reserveWindow: jest.fn().mockResolvedValue(null) } as never,
    );

    await expect(guard.canActivate(context({ userId: 'user-1' }))).rejects.toThrow(
      'distributed tenant quota store is unavailable',
    );
  });

  it('does not consume a shared budget when the atomic reservation is denied', async () => {
    const config = {
      get: jest.fn((key: string) =>
        ({
          'tenantQuota.enabled': true,
          'tenantQuota.requireDistributed': false,
          'tenantQuota.windowMs': 60_000,
          'tenantQuota.requestLimit': 60,
          'tenantQuota.dailyBudgetUsd': 0.02,
          'tenantQuota.estimatedCostPerRequestUsd': 0.02,
        })[key],
      ),
    };
    const redis = {
      reserveWindow: jest
        .fn()
        .mockResolvedValueOnce({ allowed: true, value: 1, ttlMs: 60_000 })
        .mockResolvedValueOnce({ allowed: false, value: 2, ttlMs: 86_400_000 }),
    };
    const guard = new TenantQuotaGuard(config as never, redis as never);

    await expect(guard.canActivate(context({ tenantId: 'tenant-a' }))).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(redis.reserveWindow).toHaveBeenCalledTimes(2);
  });
});
