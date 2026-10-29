import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { isDatabaseEnabled } from '../../config/runtime';
import { Order } from '../../database/entities/order.entity';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';

const databaseEnabled = isDatabaseEnabled();

@Module({
  imports: databaseEnabled ? [TypeOrmModule.forFeature([Order])] : [],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
