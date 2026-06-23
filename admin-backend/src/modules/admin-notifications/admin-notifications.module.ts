import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNotificationsController } from './admin-notifications.controller';
import { AdminNotificationsService } from './admin-notifications.service';
import { Notification } from '../../database/entities/notification.entity';
import { isDatabaseEnabled } from '../../config/runtime';

const imports = isDatabaseEnabled()
  ? [TypeOrmModule.forFeature([Notification])]
  : [];

@Module({
  imports,
  controllers: [AdminNotificationsController],
  providers: [AdminNotificationsService],
})
export class AdminNotificationsModule {}
