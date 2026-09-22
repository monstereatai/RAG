import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { ConfigService } from '@nestjs/config';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redisProvider: RedisProvider,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  readiness() {
    const databaseReady = this.dataSource.isInitialized;
    const redisReady = this.redisProvider.isEnabled();
    const redisRequired =
      this.configService.get<boolean>('core.requireDependencies') === true ||
      this.configService.get<boolean>('auth.requireDistributedTokenStore') ===
        true ||
      this.configService.get<boolean>('tenantQuota.requireDistributed') ===
        true ||
      this.configService.get<boolean>('redis.requireDistributedLock') === true ||
      this.configService.get<boolean>('domainEvents.requireDistributedLock') ===
        true;
    const response = {
      status:
        databaseReady && (redisReady || !redisRequired)
          ? redisReady
            ? 'ok'
            : 'degraded'
          : 'unavailable',
      timestamp: new Date().toISOString(),
      dependencies: {
        database: databaseReady ? 'ready' : 'unavailable',
        redis: redisReady ? 'ready' : 'disabled_or_unavailable',
      },
    } as const;
    if (!databaseReady || (redisRequired && !redisReady)) {
      throw new ServiceUnavailableException(response);
    }
    return response;
  }
}
