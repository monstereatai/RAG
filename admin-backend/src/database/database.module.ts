import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { isDatabaseEnabled } from '../config/runtime';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { Order } from './entities/order.entity';
import { Payment } from './entities/payment.entity';
import { AuditLog } from './entities/audit-log.entity';
import { ShardingService } from './sharding/sharding.service';

const databaseEnabled = isDatabaseEnabled();

@Module({
  imports: [
    ...(databaseEnabled
      ? [
          TypeOrmModule.forRootAsync({
            useFactory: () => {
              const baseConfig = {
                type: 'mysql' as const,
                database: process.env.DB_DATABASE || 'nestjs_enterprise',
                entities: [User, Role, Permission, Order, Payment, AuditLog],
                synchronize: process.env.DB_SYNCHRONIZE === 'true',
                logging: process.env.DB_LOGGING === 'true',
                retryAttempts: 1,
              };

              // 支持主从复制 (读写分离)
              const replicaHosts = process.env.DB_REPLICA_HOSTS;
              if (replicaHosts) {
                const slaves = replicaHosts.split(',').map((host) => ({
                  host: host.trim(),
                  port: parseInt(process.env.DB_PORT || '3306'),
                  username: process.env.DB_USERNAME || 'root',
                  password: process.env.DB_PASSWORD || '123456',
                }));

                return {
                  ...baseConfig,
                  replication: {
                    master: {
                      host: process.env.DB_HOST || 'localhost',
                      port: parseInt(process.env.DB_PORT || '3306'),
                      username: process.env.DB_USERNAME || 'root',
                      password: process.env.DB_PASSWORD || '123456',
                    },
                    slaves: slaves,
                  },
                };
              }

              // 单节点模式
              return {
                ...baseConfig,
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT || '3306'),
                username: process.env.DB_USERNAME || 'root',
                password: process.env.DB_PASSWORD || '123456',
              };
            },
          }),
          TypeOrmModule.forFeature([User, Role, Permission, Order, Payment, AuditLog]),
        ]
      : []),
  ],
  providers: [ShardingService],
  exports: [ShardingService],
})
export class DatabaseModule {}
