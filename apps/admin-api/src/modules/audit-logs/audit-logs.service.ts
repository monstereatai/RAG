import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../database/entities/audit-log.entity';

export interface AuditLogQuery {
  limit?: number;
  action?: string;
  actor?: string;
  keyword?: string;
}

@Injectable()
export class AuditLogsService {
  constructor(
    @Optional()
    @InjectRepository(AuditLog)
    private readonly auditLogRepository?: Repository<AuditLog>,
  ) {}

  async list(query: AuditLogQuery = {}) {
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

    if (!this.auditLogRepository) {
      return {
        storage: 'disabled',
        filters: {
          limit,
          action: query.action ?? null,
          actor: query.actor ?? null,
          keyword: query.keyword ?? null,
        },
        items: [],
        note: 'ENABLE_DATABASE=true 后可从 audit_logs 表读取真实审计记录。',
      };
    }

    const builder = this.auditLogRepository
      .createQueryBuilder('auditLog')
      .orderBy('auditLog.createdAt', 'DESC')
      .take(limit);

    if (query.action) {
      builder.andWhere('auditLog.action = :action', { action: query.action });
    }

    if (query.actor) {
      builder.andWhere(
        '(auditLog.username LIKE :actor OR auditLog.userId LIKE :actor)',
        { actor: `%${query.actor}%` },
      );
    }

    if (query.keyword) {
      builder.andWhere(
        '(auditLog.module LIKE :keyword OR auditLog.requestData LIKE :keyword OR auditLog.responseData LIKE :keyword)',
        { keyword: `%${query.keyword}%` },
      );
    }

    const items = await builder.getMany();

    return {
      storage: 'database',
      filters: {
        limit,
        action: query.action ?? null,
        actor: query.actor ?? null,
        keyword: query.keyword ?? null,
      },
      items,
    };
  }
}
