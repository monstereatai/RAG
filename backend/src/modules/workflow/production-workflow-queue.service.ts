import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import type {
  ResumeProductionWorkflowDto,
  ReviseProductionWorkflowDto,
  StartProductionWorkflowDto,
} from './production-workflow.dto';

export const PRODUCTION_WORKFLOW_QUEUE = 'production-workflow';

export type ProductionWorkflowJob =
  | {
      id: string;
      operation: 'start';
      threadId: string;
      userId: string;
      tenantId?: string;
      dto: StartProductionWorkflowDto;
    }
  | {
      id: string;
      operation: 'resume';
      threadId: string;
      userId: string;
      tenantId?: string;
      dto: ResumeProductionWorkflowDto;
    }
  | {
      id: string;
      operation: 'revise';
      threadId: string;
      userId: string;
      tenantId?: string;
      dto: ReviseProductionWorkflowDto;
    }
  | {
      id: string;
      operation: 'retry_task';
      threadId: string;
      userId: string;
      tenantId?: string;
      taskId: string;
      role: string;
    };

export interface ProductionWorkflowJobAttempt {
  attempt: number;
  finalAttempt: boolean;
}

/**
 * 生产工作流的持久队列。Redis 可用时由 BullMQ 负责重试与 Worker 接管；
 * 本地没有 Redis 时返回 false，由编排器保留受限的进程内降级路径。
 */
@Injectable()
export class ProductionWorkflowQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(ProductionWorkflowQueueService.name);
  readonly required: boolean;
  private readonly queue?: Queue<ProductionWorkflowJob>;
  private readonly worker?: Worker<ProductionWorkflowJob>;
  private processor?: (
    job: ProductionWorkflowJob,
    attempt: ProductionWorkflowJobAttempt,
  ) => Promise<void>;

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
          config?.get<number>('workflowQueue.failedRetentionSeconds') ?? 604800,
        ),
        3600,
      ),
      31_536_000,
    );
    const connection = { url: redisUrl };
    this.queue = new Queue(PRODUCTION_WORKFLOW_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: failedRetentionSeconds },
      },
    });
    this.worker = new Worker(
      PRODUCTION_WORKFLOW_QUEUE,
      async (job) => {
        if (!this.processor) {
          throw new Error('production workflow processor is not registered');
        }
        await this.processor(job.data, {
          attempt: job.attemptsMade + 1,
          finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
        });
      },
      { connection, concurrency: 1 },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        JSON.stringify({
          event: 'production_workflow.dead_letter',
          jobId: job?.id ?? null,
          threadId: job?.data.threadId ?? null,
          userId: job?.data.userId ?? null,
          tenantId: job?.data.tenantId ?? null,
          operation: job?.data.operation ?? null,
          attemptsMade: job?.attemptsMade ?? null,
          error: error.message.slice(0, 500),
        }),
      );
    });
  }

  registerProcessor(
    processor: (
      job: ProductionWorkflowJob,
      attempt: ProductionWorkflowJobAttempt,
    ) => Promise<void>,
  ): void {
    this.processor = processor;
  }

  isEnabled(): boolean {
    return Boolean(this.queue);
  }

  isRequired(): boolean {
    return this.required;
  }

  async enqueue(job: ProductionWorkflowJob): Promise<boolean> {
    if (!this.queue) {
      if (this.required) {
        throw new Error(
          '生产工作流要求使用 Redis 持久队列，当前队列未初始化，拒绝降级到进程内执行。',
        );
      }
      return false;
    }
    await this.queue.add('advance', job, { jobId: job.id });
    return true;
  }

  async getStatus(): Promise<{
    enabled: boolean;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    if (!this.queue) {
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

  /**
   * 失败任务即本队列的轻量死信入口。按 userId 过滤，避免运营接口跨租户泄露任务输入。
   */
  async listFailed(userId: string, limit = 50) {
    if (!this.queue) return [];
    const jobs = await this.queue.getFailed(0, Math.max(0, limit - 1));
    return jobs
      .filter((job) => job.data.userId === userId)
      .map((job) => ({
        id: job.id,
        operation: job.data.operation,
        threadId: job.data.threadId,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason ?? null,
        failedAt: job.finishedOn ?? null,
      }));
  }

  async retryFailed(
    jobId: string,
    userId: string,
  ): Promise<{ retried: boolean; reason?: string }> {
    if (!this.queue) return { retried: false, reason: 'queue is disabled' };
    const job = await this.queue.getJob(jobId);
    if (!job) return { retried: false, reason: 'job was expired or not found' };
    if (job.data.userId !== userId)
      return { retried: false, reason: 'not found' };
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
