import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { isDatabaseEnabled } from '../../config/runtime';
import { AuditLog } from '../../database/entities/audit-log.entity';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';

const databaseEnabled = isDatabaseEnabled();

@Module({
  imports: [
    ...(databaseEnabled ? [TypeOrmModule.forFeature([AuditLog])] : []),
  ],
  controllers: [AuditLogsController],
  providers: [AuditLogsService],
})
export class AuditLogsModule {}
