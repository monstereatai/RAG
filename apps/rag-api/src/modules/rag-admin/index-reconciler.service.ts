import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IndexRepairQueueService } from './index-repair-queue.service';
import { RagAdminService } from './rag-admin.service';

type ReconcileResult = {
  scanned: number;
  mismatched: number;
  queued: number;
  skipped: number;
};

const REPAIRABLE_AUDIT_REASONS = new Set([
  'missing_chunks',
  'elasticsearch_index_count_mismatch',
  'image_index_count_mismatch',
  'elasticsearch_content_hash_mismatch',
  'elasticsearch_generation_mismatch',
  'elasticsearch_lifecycle_mismatch',
  'graph_index_missing',
  'graph_index_failed',
  'graph_index_pending',
  'retrieval_description_document_missing',
  'retrieval_description_missing_pg',
  'retrieval_description_stale_pg',
  'retrieval_description_missing_milvus',
  'retrieval_description_stale_milvus',
  'retrieval_description_content_mismatch',
  'retrieval_description_source_mapping_mismatch',
  'retrieval_description_missing',
  'retrieval_description_stale',
  'retrieval_description_count_mismatch',
]);

/**
 * 定期把只读索引对账结果转换成持久修复任务。
 *
 * 对账与重建仍然分离：本服务只负责发现外部索引缺口并投递稳定 Job ID，
 * 真正的重建由 IndexRepairQueueService 的 Worker 执行。生产没有 Redis 队列时
 * 不启动自动修复，避免把任务留在某个实例内存中。
 */
@Injectable()
export class IndexReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexReconcilerService.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastRunAt: string | null = null;
  private lastResult: ReconcileResult | null = null;
  private lastError: string | null = null;
  private cursor: { createdAt: string; docId: string } | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly ragAdmin: RagAdminService,
    private readonly repairQueue: IndexRepairQueueService,
  ) {
    const nodeEnv =
      config.get<string>('nodeEnv') ?? process.env.NODE_ENV ?? 'development';
    const requested = config.get<boolean>('ragIndexReconciler.enabled');
    this.enabled =
      requested === true ||
      (requested === undefined && nodeEnv === 'production');
    this.intervalMs = Math.min(
      Math.max(
        Number(config.get<number>('ragIndexReconciler.intervalMs') ?? 300_000),
        30_000,
      ),
      86_400_000,
    );
    this.batchSize = Math.min(
      Math.max(
        Number(config.get<number>('ragIndexReconciler.batchSize') ?? 100),
        1,
      ),
      1_000,
    );
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    if (!this.repairQueue.isEnabled()) {
      this.logger.error(
        'Index reconciler is enabled but Redis repair queue is unavailable; automatic repair is disabled.',
      );
      return;
    }
    this.timer = setInterval(
      () => void this.runOnce('interval'),
      this.intervalMs,
    );
    this.timer.unref?.();
    // 首次运行延后一个周期，确保所有模块的 Worker processor 已注册。
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  getStatus() {
    return {
      enabled: this.enabled && this.repairQueue.isEnabled(),
      configured: this.enabled,
      queueEnabled: this.repairQueue.isEnabled(),
      running: this.running,
      intervalMs: this.intervalMs,
      batchSize: this.batchSize,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
      lastError: this.lastError,
    };
  }

  async runOnce(trigger: 'manual' | 'interval' = 'manual') {
    if (trigger === 'interval' && !this.enabled) {
      return { available: false, reason: 'disabled' } as const;
    }
    if (!this.repairQueue.isEnabled()) {
      return {
        available: false,
        reason: 'repair_queue_unavailable',
      } as const;
    }
    if (this.running)
      return { available: false, reason: 'already_running' } as const;

    this.running = true;
    this.lastRunAt = new Date().toISOString();
    this.lastError = null;
    try {
      const audit = await this.ragAdmin.auditDocumentIndexes(
        this.batchSize,
        this.cursor,
      );
      const repairable = audit.issues.filter((issue) =>
        issue.reasons.some((reason) => REPAIRABLE_AUDIT_REASONS.has(reason)),
      );
      let queued = 0;
      for (const issue of repairable) {
        await this.repairQueue.enqueue({
          id: IndexRepairQueueService.jobId(
            issue.docId,
            JSON.stringify({ reasons: issue.reasons, checks: issue.checks }),
          ),
          docId: issue.docId,
          requestedBy: 'index-reconciler',
          reason: issue.reasons.join(','),
        });
        queued += 1;
      }
      // Keep the page cursor unchanged unless every repair job was durably enqueued.
      // A retry then re-audits this page; stable job IDs make already-enqueued items safe.
      this.cursor = audit.nextCursor ?? undefined;
      const result: ReconcileResult = {
        scanned: audit.scanned,
        mismatched: repairable.length,
        queued,
        skipped: audit.issues.length - repairable.length,
      };
      this.lastResult = result;
      this.logger.log(
        JSON.stringify({
          event: 'rag_index_reconciler.completed',
          trigger,
          ...result,
        }),
      );
      return { available: true, ...result } as const;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error(
        JSON.stringify({
          event: 'rag_index_reconciler.failed',
          trigger,
          error: this.lastError.slice(0, 500),
        }),
      );
      return { available: false, reason: this.lastError } as const;
    } finally {
      this.running = false;
    }
  }
}
