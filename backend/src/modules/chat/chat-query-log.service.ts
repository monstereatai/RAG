import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import {
  redactAuditText,
  redactAuditValue,
} from '../../common/security/audit-redaction';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';

type LogQueryParams = {
  userId: string;
  query: string;
  mode: string;
  threadId: string;
  startTime: number;
  refused: boolean;
  citationCount: number;
  hasAnswer: boolean;
  answer: string;
  references: unknown[];
};

@Injectable()
export class ChatQueryLogService {
  private readonly logger = new Logger(ChatQueryLogService.name);
  private lastRetentionSweepAt = 0;

  constructor(
    @InjectRepository(QueryLogEntity)
    private readonly queryLogRepo: Repository<QueryLogEntity>,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async logQuery(params: LogQueryParams): Promise<string | undefined> {
    const id = randomUUID();
    try {
      await this.queryLogRepo.save(
        this.queryLogRepo.create({
          id,
          userId: params.userId ?? null,
          query: redactAuditText(params.query).slice(0, 2000),
          mode: params.mode as 'simple' | 'agentic' | 'auto',
          threadId: params.threadId ?? null,
          refused: params.refused,
          citationCount: params.citationCount,
          latencyMs: Date.now() - params.startTime,
          hasAnswer: params.hasAnswer,
          answer: redactAuditText(params.answer).slice(0, 20_000),
          retrievalSnapshot: JSON.stringify(
            redactAuditValue(params.references),
          ).slice(0, 100_000),
        }),
      );
      this.scheduleRetentionSweep();
      return id;
    } catch (err) {
      this.logger.warn(`Failed to log query: ${(err as Error).message}`);
      return undefined;
    }
  }

  /** Cleanup is best-effort and must not delay or fail the chat response. */
  private scheduleRetentionSweep(): void {
    const now = Date.now();
    if (now - this.lastRetentionSweepAt < 60 * 60 * 1000) return;
    this.lastRetentionSweepAt = now;
    const repo = this.queryLogRepo as unknown as {
      createQueryBuilder?: () => unknown;
    };
    if (typeof repo.createQueryBuilder !== 'function') return;
    void this.purgeExpiredQueryLogs().catch((error: unknown) => {
      this.logger.warn(
        `Failed to purge expired query logs: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  private async purgeExpiredQueryLogs(): Promise<void> {
    const retentionDays = Math.min(
      Math.max(
        Number(this.config?.get<number>('queryLog.retentionDays') ?? 180),
        1,
      ),
      3650,
    );
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    await this.queryLogRepo
      .createQueryBuilder()
      .delete()
      .from(QueryLogEntity)
      .where('createdAt < :cutoff', { cutoff })
      .execute();
  }
}
