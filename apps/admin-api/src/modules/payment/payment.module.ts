import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { isDatabaseEnabled } from '../../config/runtime';
import { Payment } from '../../database/entities/payment.entity';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';

const databaseEnabled = isDatabaseEnabled();

@Module({
  imports: databaseEnabled ? [TypeOrmModule.forFeature([Payment])] : [],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
