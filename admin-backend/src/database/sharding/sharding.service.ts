import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { isDatabaseEnabled } from '../../config/runtime';
import { Order } from '../entities/order.entity';

@Injectable()
export class ShardingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShardingService.name);
  private shardDataSources: Map<number, DataSource> = new Map();
  private inMemoryShards: Map<number, any[]> = new Map();

  async onModuleInit() {
    this.inMemoryShards.set(0, []);
    this.inMemoryShards.set(1, []);

    if (!isDatabaseEnabled()) {
      this.logger.log('当前数据库模式关闭，启用内存分片（In-memory Sharding）。');
      return;
    }

    try {
      this.logger.log('初始化分库分表数据源 (Shard 0 & Shard 1)...');
      
      // 创建物理分库 0
      const ds0 = new DataSource({
        type: 'mysql',
        host: process.env.DB_SHARD_0_HOST || process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_SHARD_0_PORT || '3306', 10),
        username: process.env.DB_SHARD_0_USERNAME || process.env.DB_USERNAME || 'root',
        password: process.env.DB_SHARD_0_PASSWORD || process.env.DB_PASSWORD,
        database: process.env.DB_SHARD_0_DATABASE || 'nestjs_enterprise_shard_0',
        entities: [Order],
        synchronize: false,
      });

      // 创建物理分库 1
      const ds1 = new DataSource({
        type: 'mysql',
        host: process.env.DB_SHARD_1_HOST || process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_SHARD_1_PORT || '3306', 10),
        username: process.env.DB_SHARD_1_USERNAME || process.env.DB_USERNAME || 'root',
        password: process.env.DB_SHARD_1_PASSWORD || process.env.DB_PASSWORD,
        database: process.env.DB_SHARD_1_DATABASE || 'nestjs_enterprise_shard_1',
        entities: [Order],
        synchronize: false,
      });

      await ds0.initialize();
      this.shardDataSources.set(0, ds0);
      this.logger.log('成功初始化分片数据源 Shard 0');

      await ds1.initialize();
      this.shardDataSources.set(1, ds1);
      this.logger.log('成功初始化分片数据源 Shard 1');

    } catch (error: any) {
      this.logger.error(`初始化分片数据源失败: ${error.message}，将回退为内存模拟分片。`);
    }
  }

  async onModuleDestroy() {
    for (const [id, ds] of this.shardDataSources.entries()) {
      if (ds.isInitialized) {
        await ds.destroy();
        this.logger.log(`分片数据源 Shard ${id} 已安全断开连接。`);
      }
    }
  }

  /**
   * 根据 Sharding Key (userId) 计算应该路由的物理分片 ID (0 或 1)
   */
  getShardId(userId: string): number {
    if (!userId) return 0;
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = (hash << 5) - hash + userId.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % 2;
  }

  /**
   * 根据 Sharding Key 动态获取物理分片的 Repository 实例。
   * 支持真实数据库与内存降级模拟。
   */
  async getShardRepository<Entity>(userId: string, entity: any): Promise<Repository<Entity> | any[]> {
    const shardId = this.getShardId(userId);

    // 1. 如果连接了真实数据库分片，返回对应的 TypeORM Repository
    const ds = this.shardDataSources.get(shardId);
    if (ds && ds.isInitialized) {
      return ds.getRepository(entity);
    }

    // 2. 否则，回退到内存分片，返回内存中的对象数组进行增删改查
    return this.inMemoryShards.get(shardId) as any[];
  }
}
