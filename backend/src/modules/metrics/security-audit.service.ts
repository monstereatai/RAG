import { Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DomainEventsService } from '../domain-events/domain-events.service';

/** 只保存策略命中元数据和查询摘要哈希，避免把用户原文写入审计表。 */
@Injectable()
export class SecurityAuditService {
  constructor(@Optional() private readonly domainEvents?: DomainEventsService) {}

  record(input: { pattern: string; route: string; userId?: string; query: string }): void {
    const queryHash = createHash('sha256').update(input.query).digest('hex');
    void this.domainEvents?.emit({
      eventType: 'security.query_blocked',
      aggregateType: 'rag_security',
      aggregateId: randomUUID(),
      idempotencyKey: `security.query_blocked:${input.route}:${input.pattern}:${queryHash}:${Math.floor(Date.now() / 60000)}`,
      payload: {
        pattern: input.pattern,
        route: input.route,
        userId: input.userId ?? 'anonymous',
        queryHash,
        recordedAt: new Date().toISOString(),
      },
    }).catch(() => undefined);
  }
}
