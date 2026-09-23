/**
 * 文档处理队列服务
 *
 * 使用 BullMQ 实现异步文档处理任务队列。
 * 上传完成后立即返回 taskId，队列 Worker 异步完成切片、Embedding、向量入库等操作。
 *
 * 依赖 Redis（复用现有 RedisProvider 的连接配置）。
 * 开发环境未配置 Redis 时可由上层降级为同步处理；生产环境拒绝进程内降级，
 * 防止异步入库任务绕过持久队列后无法跨实例接管。
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents, Worker } from 'bullmq';
import type { DocumentBusinessMetadata } from './document-profile.util';
import { ObjectStorageProvider } from '../../providers/object-storage/object-storage.provider';

export const DOCUMENT_PROCESSING_QUEUE = 'document-processing';
const DOCUMENT_SOURCE_CLEANUP_QUEUE = 'document-processing-source-cleanup';
const DOCUMENT_PROCESSING_ATTEMPTS = 3;
const FAILED_SOURCE_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface DocumentProcessingJob {
  taskId: string;
  userId: string;
  /** 请求侧租户上下文必须随持久队列一起传递，避免 Worker 丢失隔离边界。 */
  tenantId?: string;
  filename: string;
  /** 原始文件已落入对象存储，队列只传 key，避免把大文件塞进 Redis。 */
  objectKey: string;
  contentType?: string;
  businessMetadata?: DocumentBusinessMetadata;
}

export interface DocumentProcessingResult {
  taskId: string;
  status: 'completed' | 'failed';
  chunkCount?: number;
  error?: string;
}

export type DocumentProcessingProcessor = (
  job: DocumentProcessingJob,
) => Promise<{ chunkCount?: number } | void>;

@Injectable()
export class DocumentQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(DocumentQueueService.name);
  private readonly queue: Queue<DocumentProcessingJob>;
  private readonly queueEvents: QueueEvents;
  private readonly worker: Worker<DocumentProcessingJob>;
  private readonly cleanupQueue: Queue<{ objectKey: string }>;
  private readonly cleanupWorker: Worker<{ objectKey: string }>;
  private processor: DocumentProcessingProcessor | null = null;
  readonly enabled: boolean;
  readonly required: boolean;

  constructor(
    config: ConfigService,
    private readonly objectStorage: ObjectStorageProvider,
  ) {
    const nodeEnv =
      config.get<string>('nodeEnv') ?? process.env.NODE_ENV ?? 'development';
    this.required =
      nodeEnv === 'production' ||
      config.get<boolean>('core.requireDependencies') === true;
    const redisUrl = config.get<string>('redis.url');
    this.enabled = Boolean(redisUrl);

    if (!this.enabled) {
      this.logger.warn(
        this.required
          ? 'BullMQ disabled (no Redis URL). Production document processing queue is required and will reject enqueue.'
          : 'BullMQ disabled (no Redis URL). Document processing will be synchronous in development.',
      );
      // Stub objects to avoid null checks
      this.queue = null!;
      this.queueEvents = null!;
      this.worker = null!;
      this.cleanupQueue = null!;
      this.cleanupWorker = null!;
      return;
    }

    const connection = { url: redisUrl };

    this.queue = new Queue<DocumentProcessingJob>(DOCUMENT_PROCESSING_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: DOCUMENT_PROCESSING_ATTEMPTS,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600 * 24 }, // 保留 24 小时
        removeOnFail: { age: 3600 * 24 },
      },
    });

    this.queueEvents = new QueueEvents(DOCUMENT_PROCESSING_QUEUE, {
      connection,
    });

    this.worker = new Worker<DocumentProcessingJob>(
      DOCUMENT_PROCESSING_QUEUE,
      async (job) => {
        this.logger.log(
          `Processing document: ${job.data.filename} (task=${job.data.taskId})`,
        );
        if (!this.processor) {
          throw new Error('Document queue processor is not registered.');
        }
        const result = await this.processor(job.data);
        return {
          taskId: job.data.taskId,
          status: 'completed' as const,
          chunkCount: result?.chunkCount ?? 0,
        };
      },
      {
        connection,
        concurrency: Math.max(
          1,
          Number(process.env.DOCUMENT_QUEUE_CONCURRENCY ?? 2),
        ),
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(
        `Document processed: ${job.data.filename} (task=${job.data.taskId})`,
      );
      void this.cleanupSourceObject(job.data.objectKey, job.data.taskId);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Document processing failed: ${job?.data?.filename}: ${err.message}`,
      );
      if (job && job.attemptsMade >= Number(job.opts.attempts ?? 1)) {
        void this.scheduleSourceObjectCleanup(job.data);
      }
    });

    this.cleanupQueue = new Queue<{ objectKey: string }>(
      DOCUMENT_SOURCE_CLEANUP_QUEUE,
      {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: { age: 3600 * 24 * 7 },
        },
      },
    );
    this.cleanupWorker = new Worker<{ objectKey: string }>(
      DOCUMENT_SOURCE_CLEANUP_QUEUE,
      async (job) => this.objectStorage.deleteObject(job.data.objectKey),
      { connection, concurrency: 2 },
    );

    this.logger.log('Document processing queue initialized');
  }

  registerProcessor(processor: DocumentProcessingProcessor): void {
    this.processor = processor;
  }

  /**
   * 添加文档处理任务到队列
   * @returns taskId，用于前端轮询进度
   */
  async enqueue(job: DocumentProcessingJob): Promise<string> {
    if (!this.enabled) {
      if (this.required) {
        throw new Error(
          '生产文档处理要求使用 Redis 持久队列，当前队列未初始化，拒绝降级到进程内执行。',
        );
      }
      // 降级：直接处理（同步）
      this.logger.warn(
        'BullMQ not available, processing synchronously. ' +
          'Configure Redis URL for async queue.',
      );
      return job.taskId;
    }

    await this.queue.add(job.taskId, job, {
      jobId: job.taskId,
    });
    return job.taskId;
  }

  /**
   * 等待某个任务完成（可选，前端轮询用）
   */
  async waitForCompletion(
    taskId: string,
    timeoutMs = 30_000,
  ): Promise<DocumentProcessingResult | null> {
    if (!this.enabled) return null;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.queueEvents.off('completed', handler);
        this.queueEvents.off('failed', handler);
        resolve(null);
      }, timeoutMs);

      const handler = (event: {
        jobId: string;
        returnvalue?: string;
        failedReason?: string;
      }) => {
        if (event.jobId === taskId) {
          clearTimeout(timer);
          resolve({
            taskId,
            status: event.failedReason ? 'failed' : 'completed',
            error: (event as { failedReason?: string }).failedReason,
          });
        }
      };

      this.queueEvents.on('completed', handler);
      this.queueEvents.on('failed', handler);
    });
  }

  /**
   * 获取队列状态
   */
  async getStatus(): Promise<{
    enabled: boolean;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    if (!this.enabled) {
      return { enabled: false, waiting: 0, active: 0, completed: 0, failed: 0 };
    }

    const [waiting, active, completed, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
    ]);

    return { enabled: true, waiting, active, completed, failed };
  }

  /** 供运营后台定位失败任务；任务 ID 即 BullMQ jobId，重放不会新建重复任务。 */
  async listFailed(limit = 50): Promise<
    Array<{
      taskId: string;
      filename: string;
      failedReason: string | null;
      attemptsMade: number;
      failedAt: number | null;
    }>
  > {
    if (!this.enabled) return [];
    const jobs = await this.queue.getFailed(0, Math.max(0, limit - 1));
    return jobs.map((job) => ({
      taskId: job.data.taskId,
      filename: job.data.filename,
      failedReason: job.failedReason ?? null,
      attemptsMade: job.attemptsMade,
      failedAt: job.finishedOn ?? null,
    }));
  }

  async retryFailed(
    taskId: string,
  ): Promise<{ taskId: string; retried: boolean; reason?: string }> {
    if (!this.enabled)
      return { taskId, retried: false, reason: 'queue is disabled' };
    const job = await this.queue.getJob(taskId);
    if (!job)
      return { taskId, retried: false, reason: 'job was expired or not found' };
    const state = await job.getState();
    if (state !== 'failed')
      return { taskId, retried: false, reason: `job state is ${state}` };
    await this.cancelSourceObjectCleanup(taskId);
    await job.retry();
    return { taskId, retried: true };
  }

  async onModuleDestroy() {
    if (!this.enabled) return;
    await this.cleanupWorker.close();
    await this.cleanupQueue.close();
    await this.worker.close();
    await this.queueEvents.close();
    await this.queue.close();
  }

  private async scheduleSourceObjectCleanup(
    job: DocumentProcessingJob,
  ): Promise<void> {
    await this.enqueueSourceObjectCleanup(
      job.taskId,
      job.objectKey,
      FAILED_SOURCE_RETENTION_MS,
    );
  }

  private async enqueueSourceObjectCleanup(
    taskId: string,
    objectKey: string,
    delay: number,
  ): Promise<void> {
    try {
      await this.cleanupQueue.add(
        taskId,
        { objectKey },
        { jobId: taskId, delay },
      );
    } catch (error) {
      this.logger.warn(
        `queued upload cleanup scheduling failed for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async cleanupSourceObject(
    objectKey: string,
    taskId: string,
  ): Promise<void> {
    try {
      await this.cancelSourceObjectCleanup(taskId);
      await this.enqueueSourceObjectCleanup(taskId, objectKey, 0);
    } catch (error) {
      this.logger.warn(
        `queued upload cleanup failed for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async cancelSourceObjectCleanup(taskId: string): Promise<void> {
    const cleanupJob = await this.cleanupQueue.getJob(taskId);
    if (cleanupJob) await cleanupJob.remove();
  }
}
