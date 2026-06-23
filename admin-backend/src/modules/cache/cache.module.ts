import { Module } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { CacheService } from './cache.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    NestCacheModule.registerAsync({
      isGlobal: true,
      useFactory: async () => {
        const isCluster = process.env.REDIS_CLUSTER === 'true';
        
        // 确保只有在需要的时候才启用真实 redis，模板依然支持 fallback 到内存
        if (process.env.ENABLE_REDIS !== 'true') {
          return {
            ttl: 3600000,
          };
        }

        if (isCluster) {
          // Redis Cluster 配置
          const nodes = (process.env.REDIS_NODES || 'localhost:7000,localhost:7001')
            .split(',')
            .map((node) => {
              const [host, port] = node.split(':');
              return { host, port: parseInt(port) };
            });
          
          return {
            store: await redisStore({
              clusterConfig: {
                nodes: nodes,
                options: {
                  redisOptions: {
                    password: process.env.REDIS_PASSWORD,
                  },
                },
              },
            } as any),
            ttl: 3600000,
          } as any;
        }

        // 默认单点 Redis
        return {
          store: await redisStore({
            url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
            password: process.env.REDIS_PASSWORD,
          } as any),
          ttl: 3600000,
        } as any;
      },
    }),
  ],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
