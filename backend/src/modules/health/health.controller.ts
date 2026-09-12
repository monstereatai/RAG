import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisProvider } from '../../providers/redis/redis.provider';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redisProvider: RedisProvider,
  ) {}

  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  readiness() {
    const databaseReady = this.dataSource.isInitialized;
    const redisReady = this.redisProvider.isEnabled();
    const response = {
      status: databaseReady ? (redisReady ? 'ok' : 'degraded') : 'unavailable',
      timestamp: new Date().toISOString(),
      dependencies: {
        database: databaseReady ? 'ready' : 'unavailable',
        redis: redisReady ? 'ready' : 'disabled_or_unavailable',
      },
    } as const;
    if (!databaseReady) {
      throw new ServiceUnavailableException(response);
    }
    return response;
  }
}
