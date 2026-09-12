import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';

export const SCHEDULED_JOB_QUEUE = 'scheduled-analysis-jobs';

@Injectable()
export class ScheduledJobQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(ScheduledJobQueueService.name);
  private readonly queue?: Queue<{ jobId: string; triggerKey: string }>;
  private readonly worker?: Worker<{ jobId: string; triggerKey: string }>;
  private processor?: (jobId: string, triggerKey: string) => Promise<void>;
  readonly enabled: boolean;

  constructor(@Optional() private readonly config?: ConfigService) {
    const redisUrl = config?.get<string>('redis.url');
    this.enabled = Boolean(redisUrl);
    if (!redisUrl) return;
    const connection = { url: redisUrl };
    this.queue = new Queue(SCHEDULED_JOB_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      },
    });
    this.worker = new Worker(
      SCHEDULED_JOB_QUEUE,
      async (job) => {
        if (!this.processor)
          throw new Error('scheduled job processor is not registered');
        await this.processor(job.data.jobId, job.data.triggerKey);
      },
      {
        connection,
        concurrency: Math.max(
          1,
          Number(process.env.SCHEDULED_QUEUE_CONCURRENCY ?? 2),
        ),
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn(
        `scheduled queue failed ${job?.data.jobId}: ${error.message}`,
      ),
    );
  }

  setProcessor(
    processor: (jobId: string, triggerKey: string) => Promise<void>,
  ): void {
    this.processor = processor;
  }

  async enqueue(
    jobId: string,
    triggerKey: string,
    delayMs = 0,
  ): Promise<boolean> {
    if (!this.enabled || !this.queue) return false;
    await this.queue.add(
      'scheduled-job',
      { jobId, triggerKey },
      {
        jobId: `scheduled:${jobId}:${triggerKey}`,
        delay: Math.max(0, delayMs),
      },
    );
    return true;
  }

  async schedule(input: {
    id: string;
    type: string;
    cron?: string | null;
    everyMs?: number | null;
    at?: string | null;
  }): Promise<boolean> {
    if (!this.enabled || !this.queue) return false;
    const queue = this.queue as Queue & { upsertJobScheduler?: Function };
    if (input.type === 'at') {
      const delay = Math.max(
        0,
        new Date(input.at ?? '').getTime() - Date.now(),
      );
      await this.enqueue(input.id, `at:${input.at}`, delay);
      return true;
    }
    if (typeof queue.upsertJobScheduler !== 'function') {
      throw new Error('BullMQ Job Scheduler API is unavailable');
    }
    const repeat =
      input.type === 'cron'
        ? { pattern: input.cron ?? '', tz: 'Asia/Shanghai' }
        : { every: Math.max(1000, input.everyMs ?? 1000) };
    await queue.upsertJobScheduler(`scheduled:${input.id}`, repeat, {
      name: 'scheduled-job',
      data: { jobId: input.id, triggerKey: `scheduler:${input.id}` },
      opts: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    });
    return true;
  }

  async unschedule(id: string): Promise<void> {
    if (!this.enabled || !this.queue) return;
    const queue = this.queue as Queue & { removeJobScheduler?: Function };
    if (typeof queue.removeJobScheduler === 'function') {
      await queue.removeJobScheduler(`scheduled:${id}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
