import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../database/entities/audit-log.entity';

@Injectable()
export class AuditLogsService {
  constructor(
    @Optional()
    @InjectRepository(AuditLog)
    private readonly auditLogRepository?: Repository<AuditLog>,
  ) {}

  async list(limit = 20) {
    if (!this.auditLogRepository) {
      return {
        storage: 'disabled',
        items: [],
        note: 'ENABLE_DATABASE=true 后可从 audit_logs 表读取真实审计记录。',
      };
    }

    const items = await this.auditLogRepository.find({
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });

    return {
      storage: 'database',
      items,
    };
  }
}
