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

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import type { DocumentBusinessMetadata } from './document-profile.util';
import { ObjectStorageProvider } from '../../providers/object-storage/object-storage.provider';
import { RedisProvider } from '../../providers/redis/redis.provider';
import {
  LlmProvider,
  LlmRequestBudgetExceededError,
} from '../../providers/llm/llm.provider';

export const DOCUMENT_PROCESSING_QUEUE = 'document-processing';
export const DOCUMENT_GRAPH_INDEX_QUEUE = 'document-graph-index';
export const OBSIDIAN_NOTE_INGEST_QUEUE = 'obsidian-note-ingest';
const DOCUMENT_SOURCE_CLEANUP_QUEUE = 'document-processing-source-cleanup';
const DOCUMENT_PROCESSING_ATTEMPTS = 3;
// 给对象写入留出安全窗口；进程若在写入后崩溃，job 到期后仍会自动执行。
const DOCUMENT_UPLOAD_STAGING_DELAY_MS = 5 * 60 * 1000;
const FAILED_SOURCE_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface ObsidianNoteIngestJob {
  taskId: string;
  docId: string;
  userId: string;
  title: string;
  /** 原始正文的 SHA-256；用它保持 Obsidian 去重稳定，不传正文。 */
  contentHash: string;
  sourceUrl?: string;
  sourceType: 'url' | 'document' | 'official-docs' | 'manual';
  contentType?: string;
  filename?: string;
}

export type ObsidianNoteIngestInput = Omit<ObsidianNoteIngestJob, 'taskId'>;

export type ObsidianNoteIngestProcessor = (
  job: ObsidianNoteIngestJob,
) => Promise<void>;

export interface DocumentProcessingJob {
  taskId: string;
  userId: string;
  /** 请求侧租户上下文必须随持久队列一起传递，避免 Worker 丢失隔离边界。 */
  tenantId?: string;
  /** Set only when enqueued by the ServiceTokenGuard-protected Admin bridge. */
  trustedAdminPrincipal?: boolean;
  filename: string;
  /** 源文件先写入对象存储，队列只传 key，避免把大文件塞进 Redis。 */
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

export type DocumentProcessingFailureHandler = (
  job: DocumentProcessingJob,
  error: Error,
) => Promise<void>;

async function runWithinLlmBudget<T>(
  llmProvider: LlmProvider | undefined,
  job: { discard: () => void },
  callback: () => Promise<T>,
): Promise<T> {
  try {
    return llmProvider
      ? await llmProvider.runWithRequestBudget(callback)
      : await callback();
  } catch (error) {
    if (error instanceof LlmRequestBudgetExceededError) job.discard();
    throw error;
  }
}

export interface DocumentGraphIndexJob {
  docId: string;
  userId: string;
  indexGeneration: string;
}

export type DocumentGraphIndexProcessor = (
  job: DocumentGraphIndexJob,
) => Promise<void>;

export type DocumentGraphIndexFailureHandler = (
  job: DocumentGraphIndexJob,
  error: Error,
) => Promise<void>;

export interface PendingDocumentQueueTask {
  taskId: string;
  filename: string;
  status: 'waiting' | 'delayed' | 'paused' | 'waiting-children';
  createdAt: number;
}

@Injectable()
export class DocumentQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(DocumentQueueService.name);
  private readonly queue: Queue<DocumentProcessingJob>;
  private readonly queueEvents: QueueEvents;
  private readonly worker: Worker<DocumentProcessingJob>;
  private readonly obsidianQueue: Queue<ObsidianNoteIngestJob>;
  private readonly obsidianWorker: Worker<ObsidianNoteIngestJob>;
  private readonly graphQueue: Queue<DocumentGraphIndexJob>;
  private readonly graphQueueEvents: QueueEvents;
  private readonly graphWorker: Worker<DocumentGraphIndexJob>;
  private readonly cleanupQueue: Queue<{ objectKey: string }>;
  private readonly cleanupWorker: Worker<{ objectKey: string }>;
  private processor: DocumentProcessingProcessor | null = null;
  private failureHandler: DocumentProcessingFailureHandler | null = null;
  private obsidianProcessor: ObsidianNoteIngestProcessor | null = null;
  private graphProcessor: DocumentGraphIndexProcessor | null = null;
  private graphFailureHandler: DocumentGraphIndexFailureHandler | null = null;
  readonly enabled: boolean;
  readonly required: boolean;

  constructor(
    config: ConfigService,
    private readonly objectStorage: ObjectStorageProvider,
    @Optional() private readonly redisProvider?: RedisProvider,
    @Optional() private readonly llmProvider?: LlmProvider,
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
      this.obsidianQueue = null!;
      this.obsidianWorker = null!;
      this.graphQueue = null!;
      this.graphQueueEvents = null!;
      this.graphWorker = null!;
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

    this.obsidianQueue = new Queue<ObsidianNoteIngestJob>(
      OBSIDIAN_NOTE_INGEST_QUEUE,
      {
        connection,
        defaultJobOptions: {
          attempts: DOCUMENT_PROCESSING_ATTEMPTS,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 3600 * 24 },
          removeOnFail: { age: 3600 * 24 },
        },
      },
    );

    this.graphQueue = new Queue<DocumentGraphIndexJob>(
      DOCUMENT_GRAPH_INDEX_QUEUE,
      {
        connection,
        defaultJobOptions: {
          attempts: DOCUMENT_PROCESSING_ATTEMPTS,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 3600 * 24 },
          removeOnFail: { age: 3600 * 24 * 7 },
        },
      },
    );
    this.graphQueueEvents = new QueueEvents(DOCUMENT_GRAPH_INDEX_QUEUE, {
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
        const result = await runWithinLlmBudget(
          this.llmProvider,
          job,
          () => this.processor!(job.data),
        );
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

    this.obsidianWorker = new Worker<ObsidianNoteIngestJob>(
      OBSIDIAN_NOTE_INGEST_QUEUE,
      async (job) => {
        if (!this.obsidianProcessor) {
          throw new Error('Obsidian note queue processor is not registered.');
        }
        await runWithinLlmBudget(this.llmProvider, job, () =>
          this.obsidianProcessor!(job.data),
        );
      },
      {
        connection,
        concurrency: Math.max(
          1,
          Number(process.env.OBSIDIAN_NOTE_QUEUE_CONCURRENCY ?? 1),
        ),
      },
    );

    this.graphWorker = new Worker<DocumentGraphIndexJob>(
      DOCUMENT_GRAPH_INDEX_QUEUE,
      async (job) => {
        if (!this.graphProcessor) {
          throw new Error('Document graph index processor is not registered.');
        }
        await runWithinLlmBudget(this.llmProvider, job, () =>
          this.withGraphIndexLock(job.data.docId, () =>
            this.graphProcessor!(job.data),
          ),
        );
      },
      { connection, concurrency: 1 },
    );

    this.graphWorker.on('failed', (job, err) => {
      if (
        !job ||
        job.attemptsMade < Number(job.opts.attempts ?? 1) ||
        !this.graphFailureHandler
      ) {
        return;
      }
      void this.graphFailureHandler(job.data, err).catch((handlerError) => {
        this.logger.error(
          `Graph index failure callback failed for doc=${job.data.docId}: ${handlerError instanceof Error ? handlerError.message : String(handlerError)}`,
        );
      });
    });

    this.obsidianWorker.on('failed', (job, err) => {
      this.logger.error(
        `Obsidian note ingest failed for doc=${job?.data?.docId}: ${err.message}`,
      );
    });

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
        if (this.failureHandler) {
          void this.failureHandler(job.data, err).catch(
            (handlerError: unknown) => {
              this.logger.error(
                `Document failure callback failed for task=${job.data.taskId}: ${handlerError instanceof Error ? handlerError.message : String(handlerError)}`,
              );
            },
          );
        }
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

  registerFailureHandler(handler: DocumentProcessingFailureHandler): void {
    this.failureHandler = handler;
  }

  registerObsidianNoteProcessor(processor: ObsidianNoteIngestProcessor): void {
    this.obsidianProcessor = processor;
  }

  registerGraphIndexProcessor(processor: DocumentGraphIndexProcessor): void {
    this.graphProcessor = processor;
  }

  registerGraphIndexFailureHandler(
    handler: DocumentGraphIndexFailureHandler,
  ): void {
    this.graphFailureHandler = handler;
  }

  async enqueueGraphIndex(job: DocumentGraphIndexJob): Promise<boolean> {
    if (!this.enabled) return false;
    const jobId = this.graphJobId(job.docId, job.indexGeneration);
    const existing = await this.graphQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed') {
        await existing.retry();
        return true;
      }
      if (state === 'completed') await existing.remove();
      else return true;
    }
    await this.graphQueue.add(jobId, job, { jobId });
    return true;
  }

  /** 删除文档前移除排队中的图索引，并等待正在写图的任务结束。 */
  async cancelGraphIndexes(docId: string): Promise<void> {
    if (!this.enabled) return;
    const jobs: Awaited<ReturnType<typeof this.graphQueue.getJobs>> = [];
    const pageSize = 500;
    let start = 0;
    while (true) {
      const page = await this.graphQueue.getJobs(
        ['waiting', 'delayed', 'paused', 'waiting-children', 'active'],
        start,
        start + pageSize - 1,
      );
      jobs.push(...page);
      if (page.length < pageSize) break;
      start += page.length;
    }
    for (const job of jobs.filter((candidate) => candidate.data.docId === docId)) {
      const state = await job.getState();
      if (state === 'active') {
        try {
          await job.waitUntilFinished(this.graphQueueEvents, 30_000);
        } catch (error) {
          if ((await job.getState()) === 'active') throw error;
        }
      } else if (state !== 'completed' && state !== 'failed') {
        await job.remove();
      }
    }
  }

  /** 多实例共享 Redis 锁，避免同一文档的两个图谱重建互相覆盖。 */
  async withGraphIndexLock<T>(
    docId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    if (!this.redisProvider?.isEnabled()) {
      if (this.required) throw new Error('Redis unavailable for graph index lock');
      return work();
    }
    const lockKey = `rag:document:graph-index-lock:${docId}`;
    const token = randomUUID();
    const acquired = await this.redisProvider.setIfAbsentRequired(
      lockKey,
      token,
      300,
    );
    if (!acquired) throw new Error(`graph index is already running for ${docId}`);
    let lockLost = false;
    const renewalTimer = setInterval(() => {
      void this.redisProvider!
        .renewLock(lockKey, token, 300)
        .then((renewed) => {
          if (!renewed) lockLost = true;
        })
        .catch(() => {
          lockLost = true;
        });
    }, 60_000);
    renewalTimer.unref?.();
    try {
      const result = await work();
      if (lockLost) throw new Error(`graph index lock was lost for ${docId}`);
      return result;
    } finally {
      clearInterval(renewalTimer);
      await this.redisProvider.compareAndDeleteRequired(lockKey, token);
    }
  }

  /**
   * 笔记整理是可选任务。队列不可用时返回 skipped，不影响已完成的 RAG 入库。
   * BullMQ 只保存文档 ID 和少量元信息，Worker 再从 PostgreSQL 读取已入库原文。
   */
  async enqueueObsidianNote(input: ObsidianNoteIngestInput): Promise<{
    status: 'queued' | 'skipped';
    taskId?: string;
    reason?: string;
  }> {
    if (!this.enabled) {
      return { status: 'skipped', reason: 'Redis/BullMQ is unavailable' };
    }

    const taskId = `obsidian-${input.docId}`;
    const configuredTimeout = Number(
      process.env.OBSIDIAN_NOTE_ENQUEUE_TIMEOUT_MS ?? 1000,
    );
    const timeoutMs = Number.isFinite(configuredTimeout)
      ? Math.max(100, configuredTimeout)
      : 1000;
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.obsidianQueue.add(taskId, { ...input, taskId }, { jobId: taskId }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Obsidian note queue enqueue timed out')),
            timeoutMs,
          );
        }),
      ]);
      return { status: 'queued', taskId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Obsidian note task skipped for doc=${input.docId}: ${reason}`,
      );
      return { status: 'skipped', reason };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
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
   * 先持久化完整 job，但延迟执行；上传方写完对象后再 promote。
   * 若进程在对象写入后崩溃，延迟到期后 Worker 仍能接手该任务。
   */
  async stageUpload(job: DocumentProcessingJob): Promise<void> {
    if (!this.enabled) {
      throw new Error('Redis/BullMQ is required to stage document uploads.');
    }
    await this.queue.add(job.taskId, job, {
      jobId: job.taskId,
      delay: DOCUMENT_UPLOAD_STAGING_DELAY_MS,
    });
  }

  async promoteUpload(taskId: string): Promise<void> {
    if (!this.enabled) {
      throw new Error('Redis/BullMQ is required to promote document uploads.');
    }
    const job = await this.queue.getJob(taskId);
    if (!job) throw new Error(`staged document job not found: ${taskId}`);
    const state = await job.getState();
    if (state === 'delayed') {
      await job.promote();
    } else if (state !== 'waiting' && state !== 'active') {
      throw new Error(`staged document job cannot be promoted from ${state}`);
    }
  }

  async removeStagedUpload(taskId: string): Promise<void> {
    if (!this.enabled) return;
    const job = await this.queue.getJob(taskId);
    if (!job) return;
    const state = await job.getState();
    if (this.isPendingState(state)) await job.remove();
  }

  async getJobState(taskId: string): Promise<string | null> {
    if (!this.enabled) return null;
    const job = await this.queue.getJob(taskId);
    return job ? job.getState() : null;
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

  async listPending(limit = 50): Promise<{
    enabled: boolean;
    tasks: PendingDocumentQueueTask[];
  }> {
    if (!this.enabled) return { enabled: false, tasks: [] };
    const jobs = await this.queue.getJobs(
      ['waiting', 'delayed', 'paused', 'waiting-children'],
      0,
      Math.max(0, Math.min(limit, 100) - 1),
    );
    return {
      enabled: true,
      tasks: await Promise.all(
        jobs.map(async (job) => ({
          taskId: job.data.taskId,
          filename: job.data.filename,
          status: (await job.getState()) as PendingDocumentQueueTask['status'],
          createdAt: job.timestamp,
        })),
      ),
    };
  }

  async cancelPending(taskId: string): Promise<{
    taskId: string;
    cancelled: boolean;
    cleanupScheduled?: boolean;
    cleanupCompleted?: boolean;
    reason?: string;
  }> {
    if (!this.enabled) {
      return {
        taskId,
        cancelled: false,
        reason: 'Redis/BullMQ 不可用，无法取消排队任务。',
      };
    }
    const job = await this.queue.getJob(taskId);
    if (!job) {
      return { taskId, cancelled: false, reason: '队列任务不存在或已过期。' };
    }

    const state = await job.getState();
    if (!this.isPendingState(state)) {
      return {
        taskId,
        cancelled: false,
        reason:
          state === 'active'
            ? '任务已处理中，无法中断。'
            : `任务状态为 ${state}，无法取消。`,
      };
    }

    try {
      await job.remove();
    } catch (error) {
      // Worker 可能在检查状态后立即领取任务。BullMQ 会拒绝移除已锁定任务；
      // 重新读取状态以给操作者明确说明，不把竞态误报成成功。
      const currentState = await job.getState().catch(() => 'unknown');
      return {
        taskId,
        cancelled: false,
        reason:
          currentState === 'active'
            ? '任务已处理中，无法中断。'
            : `队列任务未能移除：${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const cleanupScheduled = await this.enqueueSourceObjectCleanup(
      taskId,
      job.data.objectKey,
      0,
    );
    let cleanupCompleted = false;
    if (!cleanupScheduled) {
      try {
        await this.objectStorage.deleteObject(job.data.objectKey);
        cleanupCompleted = true;
      } catch (error) {
        this.logger.error(
          `cancelled upload cleanup failed for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return {
      taskId,
      cancelled: true,
      cleanupScheduled,
      cleanupCompleted,
      ...(cleanupScheduled || cleanupCompleted
        ? {}
        : {
            reason:
              '任务已取消，但原文件清理任务未能入队，请检查队列连接后手动清理。',
          }),
    };
  }

  private isPendingState(
    state: string,
  ): state is PendingDocumentQueueTask['status'] {
    return (
      state === 'waiting' ||
      state === 'delayed' ||
      state === 'paused' ||
      state === 'waiting-children'
    );
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
    await this.graphWorker.close();
    await this.graphQueueEvents.close();
    await this.graphQueue.close();
    await this.obsidianWorker.close();
    await this.obsidianQueue.close();
    await this.worker.close();
    await this.queueEvents.close();
    await this.queue.close();
  }

  private graphJobId(docId: string, indexGeneration: string): string {
    const digest = createHash('sha256')
      .update(`${docId}:${indexGeneration}`)
      .digest('hex')
      .slice(0, 32);
    return `graph-${digest}`;
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
  ): Promise<boolean> {
    try {
      await this.cleanupQueue.add(
        taskId,
        { objectKey },
        { jobId: taskId, delay },
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `queued upload cleanup scheduling failed for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
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
