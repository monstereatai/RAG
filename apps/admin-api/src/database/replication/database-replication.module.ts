import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from '../entities/user.entity';
import { Order } from '../entities/order.entity';
import { Payment } from '../entities/payment.entity';

@Module({
  imports: [
    // 主数据库配置
    TypeOrmModule.forRootAsync({
      name: 'master',
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('MASTER_DB_HOST', 'localhost'),
        port: configService.get<number>('MASTER_DB_PORT', 3306),
        username: configService.get<string>('MASTER_DB_USERNAME', 'root'),
        password: configService.get<string>('MASTER_DB_PASSWORD', '123456'),
        database: configService.get<string>('MASTER_DB_DATABASE', 'nestjs_enterprise_master'),
        entities: [User, Order, Payment],
        synchronize: false,
        logging: configService.get<boolean>('DB_LOGGING', false),
        extra: {
          connectionLimit: 10,
          acquireTimeout: 60000,
          timeout: 60000,
          reconnect: true,
        },
      }),
      inject: [ConfigService],
    }),

    // 从数据库配置
    TypeOrmModule.forRootAsync({
      name: 'slave',
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('SLAVE_DB_HOST', 'localhost'),
        port: configService.get<number>('SLAVE_DB_PORT', 3306),
        username: configService.get<string>('SLAVE_DB_USERNAME', 'root'),
        password: configService.get<string>('SLAVE_DB_PASSWORD', '123456'),
        database: configService.get<string>('SLAVE_DB_DATABASE', 'nestjs_enterprise_slave'),
        entities: [User, Order, Payment],
        synchronize: false,
        logging: configService.get<boolean>('DB_LOGGING', false),
        extra: {
          connectionLimit: 20,
          acquireTimeout: 60000,
          timeout: 60000,
          reconnect: true,
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseReplicationModule {}
