import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { createHash } from 'node:crypto';

export const INDEX_REPAIR_QUEUE = 'rag-index-repair';

export interface IndexRepairJob {
  id: string;
  docId: string;
  requestedBy: string;
  reason?: string;
}

export type IndexRepairProcessor = (job: IndexRepairJob) => Promise<void>;

/**
 * 跨索引修复队列。
 *
 * 对账本身是只读的，真正的重建通过 BullMQ 处理，避免管理请求串行占满
 * HTTP 连接；生产／严格依赖模式没有 Redis 时 fail-closed，防止修复任务
 * 只存在于某个实例的内存里。
 */
@Injectable()
export class IndexRepairQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(IndexRepairQueueService.name);
  readonly required: boolean;
  private readonly queue?: Queue<IndexRepairJob>;
  private readonly worker?: Worker<IndexRepairJob>;
  private processor?: IndexRepairProcessor;

  constructor(@Optional() config?: ConfigService) {
    const nodeEnv =
      config?.get<string>('nodeEnv') ?? process.env.NODE_ENV ?? 'development';
    this.required =
      nodeEnv === 'production' ||
      config?.get<boolean>('core.requireDependencies') === true;
    const redisUrl = config?.get<string>('redis.url');
    if (!redisUrl) return;

    const failedRetentionSeconds = Math.min(
      Math.max(
        Number(
          config?.get<number>('workflowQueue.failedRetentionSeconds') ??
            604800,
        ),
        3600,
      ),
      31_536_000,
    );
    const connection = { url: redisUrl };
    this.queue = new Queue<IndexRepairJob>(INDEX_REPAIR_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: failedRetentionSeconds },
      },
    });
    this.worker = new Worker<IndexRepairJob>(
      INDEX_REPAIR_QUEUE,
      async (job) => {
        if (!this.processor) throw new Error('index repair processor is not registered');
        await this.processor(job.data);
      },
      {
        connection,
        concurrency: Math.max(
          1,
          Number(config?.get<number>('DOCUMENT_QUEUE_CONCURRENCY') ?? 1),
        ),
      },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        JSON.stringify({
          event: 'rag_index_repair.dead_letter',
          jobId: job?.id ?? null,
          docId: job?.data.docId ?? null,
          requestedBy: job?.data.requestedBy ?? null,
          attemptsMade: job?.attemptsMade ?? null,
          error: error.message.slice(0, 500),
        }),
      );
    });
  }

  registerProcessor(processor: IndexRepairProcessor): void {
    this.processor = processor;
  }

  isEnabled(): boolean {
    return Boolean(this.queue);
  }

  isRequired(): boolean {
    return this.required;
  }

  static jobId(docId: string, fingerprint = ''): string {
    return `index-repair-${createHash('sha256')
      .update(`${docId}:${fingerprint}`)
      .digest('hex')
      .slice(0, 32)}`;
  }

  async enqueue(job: IndexRepairJob): Promise<boolean> {
    if (!this.queue) {
      if (this.required) {
        throw new Error(
          '生产索引修复要求使用 Redis 持久队列，当前队列未初始化，拒绝降级到进程内执行。',
        );
      }
      return false;
    }
    await this.queue.add('reindex', job, { jobId: job.id });
    return true;
  }

  async getStatus(): Promise<{
    enabled: boolean;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    if (!this.queue)
      return { enabled: false, waiting: 0, active: 0, completed: 0, failed: 0 };
    const [waiting, active, completed, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
    ]);
    return { enabled: true, waiting, active, completed, failed };
  }

  async listFailed(limit = 50) {
    if (!this.queue) return [];
    const jobs = await this.queue.getFailed(0, Math.max(0, limit - 1));
    return jobs.map((job) => ({
      id: job.id,
      docId: job.data.docId,
      requestedBy: job.data.requestedBy,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason ?? null,
      failedAt: job.finishedOn ?? null,
    }));
  }

  async retryFailed(
    jobId: string,
  ): Promise<{ retried: boolean; reason?: string }> {
    if (!this.queue) return { retried: false, reason: 'queue is disabled' };
    const job = await this.queue.getJob(jobId);
    if (!job) return { retried: false, reason: 'job was expired or not found' };
    const state = await job.getState();
    if (state !== 'failed') {
      return { retried: false, reason: `job state is ${state}` };
    }
    await job.retry();
    return { retried: true };
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
