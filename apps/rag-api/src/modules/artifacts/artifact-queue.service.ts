import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';

const ARTIFACT_QUEUE = 'artifact-generation';
type Processor = (artifactId: string) => Promise<void>;

@Injectable()
export class ArtifactQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(ArtifactQueueService.name);
  private readonly queue: Queue<{ artifactId: string }> | null;
  private readonly worker: Worker<{ artifactId: string }> | null;
  readonly required: boolean;
  private processor: Processor | null = null;

  constructor(config: ConfigService) {
    const nodeEnv =
      config.get<string>('nodeEnv') ?? process.env.NODE_ENV ?? 'development';
    this.required =
      nodeEnv === 'production' ||
      config.get<boolean>('core.requireDependencies') === true;
    const redisUrl = config.get<string>('redis.url');
    if (!redisUrl) {
      this.queue = null;
      this.worker = null;
      this.logger.warn(
        this.required
          ? 'Artifact queue is unavailable because Redis is required in production; enqueue will fail closed.'
          : 'Artifact queue uses in-process fallback because Redis is unavailable.',
      );
      return;
    }

    const connection = { url: redisUrl };
    this.queue = new Queue(ARTIFACT_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 86400 * 7 },
      },
    });
    this.worker = new Worker(
      ARTIFACT_QUEUE,
      async (job) => {
        if (!this.processor)
          throw new Error('Artifact processor is not registered.');
        await this.processor(job.data.artifactId);
      },
      { connection, concurrency: 1 },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Artifact job ${job?.data.artifactId ?? 'unknown'} failed: ${error.message}`,
      );
    });
  }

  registerProcessor(processor: Processor): void {
    this.processor = processor;
  }

  async enqueue(artifactId: string): Promise<void> {
    if (this.queue) {
      await this.queue.add(artifactId, { artifactId }, { jobId: artifactId });
      return;
    }
    if (this.required) {
      throw new Error(
        '生产 Artifact 生成要求使用 Redis 持久队列，拒绝进程内降级。',
      );
    }
    setImmediate(() => {
      void this.processor?.(artifactId).catch((error: Error) => {
        this.logger.error(
          `Artifact job ${artifactId} failed: ${error.message}`,
        );
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
