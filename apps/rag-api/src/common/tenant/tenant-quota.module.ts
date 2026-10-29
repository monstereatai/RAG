import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../../providers/redis/redis.module';
import { TenantQuotaGuard } from '../guards/tenant-quota.guard';

@Global()
@Module({
  imports: [ConfigModule, RedisModule],
  providers: [TenantQuotaGuard],
  exports: [TenantQuotaGuard],
})
export class TenantQuotaModule {}
