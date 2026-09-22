import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports degraded readiness when Redis is unavailable but the database is ready', () => {
    const controller = new HealthController(
      { isInitialized: true } as never,
      { isEnabled: () => false } as never,
      { get: () => false } as never,
    );

    expect(controller.readiness()).toMatchObject({
      status: 'degraded',
      dependencies: {
        database: 'ready',
        redis: 'disabled_or_unavailable',
      },
    });
  });

  it('returns service unavailable when the database is not ready', () => {
    const controller = new HealthController(
      { isInitialized: false } as never,
      { isEnabled: () => true } as never,
      { get: () => false } as never,
    );

    expect(() => controller.readiness()).toThrow(ServiceUnavailableException);
  });

  it('returns service unavailable when a production Redis boundary is required', () => {
    const controller = new HealthController(
      { isInitialized: true } as never,
      { isEnabled: () => false } as never,
      {
        get: (key: string) =>
          key === 'tenantQuota.requireDistributed' ? true : false,
      } as never,
    );

    expect(() => controller.readiness()).toThrow(ServiceUnavailableException);
  });
});
