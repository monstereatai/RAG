/**
 * 文档处理队列服务
 *
 * 使用 BullMQ 实现异步文档处理任务队列。
 * 上传完成后立即返回 taskId，队列 Worker 异步完成切片、Embedding、向量入库等操作。
 *
 * 依赖 Redis（复用现有 RedisProvider 的连接配置）。
 * 未配置 Redis 时自动降级为同步处理。
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents, Worker } from 'bullmq';
import type { DocumentBusinessMetadata } from './document-profile.util';

export const DOCUMENT_PROCESSING_QUEUE = 'document-processing';

export interface DocumentProcessingJob {
  taskId: string;
  userId: string;
  filename: string;
  originalBufferBase64: string;
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
  private processor: DocumentProcessingProcessor | null = null;
  readonly enabled: boolean;

  constructor(config: ConfigService) {
    const redisUrl = config.get<string>('redis.url');
    this.enabled = Boolean(redisUrl);

    if (!this.enabled) {
      this.logger.warn(
        'BullMQ disabled (no Redis URL). Document processing will be synchronous.',
      );
      // Stub objects to avoid null checks
      this.queue = null!;
      this.queueEvents = null!;
      this.worker = null!;
      return;
    }

    const connection = { url: redisUrl };

    this.queue = new Queue<DocumentProcessingJob>(DOCUMENT_PROCESSING_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
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
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Document processing failed: ${job?.data?.filename}: ${err.message}`,
      );
    });

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

  async onModuleDestroy() {
    if (!this.enabled) return;
    await this.worker.close();
    await this.queueEvents.close();
    await this.queue.close();
  }
}
