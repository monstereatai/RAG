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
      dto: StartProductionWorkflowDto;
    }
  | {
      id: string;
      operation: 'resume';
      threadId: string;
      userId: string;
      dto: ResumeProductionWorkflowDto;
    }
  | {
      id: string;
      operation: 'revise';
      threadId: string;
      userId: string;
      dto: ReviseProductionWorkflowDto;
    }
  | {
      id: string;
      operation: 'retry_task';
      threadId: string;
      userId: string;
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
  private readonly queue?: Queue<ProductionWorkflowJob>;
  private readonly worker?: Worker<ProductionWorkflowJob>;
  private processor?: (
    job: ProductionWorkflowJob,
    attempt: ProductionWorkflowJobAttempt,
  ) => Promise<void>;

  constructor(@Optional() config?: ConfigService) {
    const redisUrl = config?.get<string>('redis.url');
    if (!redisUrl) return;
    const connection = { url: redisUrl };
    this.queue = new Queue(PRODUCTION_WORKFLOW_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
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
        `production workflow job ${job?.data.threadId ?? 'unknown'} failed: ${error.message}`,
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

  async enqueue(job: ProductionWorkflowJob): Promise<boolean> {
    if (!this.queue) return false;
    await this.queue.add('advance', job, { jobId: job.id });
    return true;
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
