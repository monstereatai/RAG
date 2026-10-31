import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';
import { Counter, Gauge, Histogram } from 'prom-client';

const QUEUE_NAMES = [
  'document-processing',
  'document-graph-index',
  'obsidian-note-ingest',
  'document-processing-source-cleanup',
  'artifact-generation',
  'production-workflow',
  'scheduled-analysis-jobs',
  'rag-index-repair',
] as const;

const QUEUE_STATES = [
  'waiting',
  'active',
  'delayed',
  'failed',
  'completed',
  'paused',
] as const;

const SNAPSHOT_INTERVAL_MS = 15_000;
const ERROR_LOG_INTERVAL_MS = 60_000;

@Injectable()
export class BullMqQueueMetricsService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BullMqQueueMetricsService.name);
  private readonly queues = new Map<string, Queue>();
  private readonly queueEvents = new Map<string, QueueEvents>();
  private readonly lastErrorLoggedAt = new Map<string, number>();
  private snapshotTimer?: NodeJS.Timeout;
  private snapshotInFlight = false;

  private readonly queueJobs = new Gauge({
    name: 'rag_bullmq_queue_jobs',
    help: 'BullMQ jobs by queue and current state',
    labelNames: ['queue', 'state'] as const,
  });

  private readonly queueMonitorUp = new Gauge({
    name: 'rag_bullmq_queue_monitor_up',
    help: 'Whether the latest BullMQ queue snapshot succeeded',
    labelNames: ['queue'] as const,
  });

  private readonly oldestWaitingSeconds = new Gauge({
    name: 'rag_bullmq_oldest_waiting_seconds',
    help: 'Age of the oldest currently waiting BullMQ job',
    labelNames: ['queue'] as const,
  });

  private readonly jobEventsTotal = new Counter({
    name: 'rag_bullmq_job_events_total',
    help: 'BullMQ completed and failed-attempt events by queue',
    labelNames: ['queue', 'event'] as const,
  });

  private readonly queueWaitDuration = new Histogram({
    name: 'rag_bullmq_queue_wait_duration_seconds',
    help: 'Time from BullMQ enqueue to worker start',
    labelNames: ['queue'] as const,
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600],
  });

  private readonly jobProcessingDuration = new Histogram({
    name: 'rag_bullmq_job_processing_duration_seconds',
    help: 'BullMQ worker processing duration per attempt',
    labelNames: ['queue', 'outcome'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  });

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const redisUrl = this.config.get<string>('redis.url');
    if (!redisUrl) {
      for (const queueName of QUEUE_NAMES) {
        this.queueMonitorUp.set({ queue: queueName }, 0);
      }
      return;
    }

    for (const queueName of QUEUE_NAMES) {
      this.registerQueue(queueName, redisUrl);
    }
    void this.refreshSnapshots();
    this.snapshotTimer = setInterval(
      () => void this.refreshSnapshots(),
      SNAPSHOT_INTERVAL_MS,
    );
    this.snapshotTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    await Promise.allSettled([
      ...[...this.queueEvents.values()].map((events) => events.close()),
      ...[...this.queues.values()].map((queue) => queue.close()),
    ]);
  }

  private registerQueue(queueName: string, redisUrl: string): void {
    let queue: Queue | undefined;
    let events: QueueEvents | undefined;
    try {
      const connection = { url: redisUrl };
      queue = new Queue(queueName, { connection });
      events = new QueueEvents(queueName, { connection });
      queue.on('error', (error: Error) => this.logQueueError(queueName, error));
      events.on('error', (error: Error) =>
        this.logQueueError(queueName, error),
      );
      events.on('completed', ({ jobId }) =>
        this.recordJobEvent(queueName, 'completed', jobId),
      );
      events.on('failed', ({ jobId }) =>
        this.recordJobEvent(queueName, 'failed_attempt', jobId),
      );
      this.queues.set(queueName, queue);
      this.queueEvents.set(queueName, events);
      this.queueMonitorUp.set({ queue: queueName }, 0);
    } catch (error) {
      void events?.close().catch(() => undefined);
      void queue?.close().catch(() => undefined);
      this.queueMonitorUp.set({ queue: queueName }, 0);
      this.logQueueError(
        queueName,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private async refreshSnapshots(): Promise<void> {
    if (this.snapshotInFlight) return;
    this.snapshotInFlight = true;
    try {
      await Promise.all(
        [...this.queues.entries()].map(async ([queueName, queue]) => {
          try {
            const counts = await queue.getJobCounts(...QUEUE_STATES);
            for (const state of QUEUE_STATES) {
              this.queueJobs.set(
                { queue: queueName, state },
                Number(counts[state] ?? 0),
              );
            }
            const oldest = await queue.getJobs(['waiting'], 0, 0);
            const enqueuedAt = Number(oldest[0]?.timestamp);
            this.oldestWaitingSeconds.set(
              { queue: queueName },
              Number.isFinite(enqueuedAt)
                ? Math.max(0, (Date.now() - enqueuedAt) / 1000)
                : 0,
            );
            this.queueMonitorUp.set({ queue: queueName }, 1);
          } catch (error) {
            this.queueMonitorUp.set({ queue: queueName }, 0);
            this.logQueueError(
              queueName,
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        }),
      );
    } finally {
      this.snapshotInFlight = false;
    }
  }

  private recordJobEvent(
    queueName: string,
    event: 'completed' | 'failed_attempt',
    jobId: string,
  ): void {
    this.jobEventsTotal.inc({ queue: queueName, event });
    const queue = this.queues.get(queueName);
    if (!queue) return;

    void queue
      .getJob(jobId)
      .then((job) => {
        if (!job) return;
        const processedAt = Number(job.processedOn);
        const enqueuedAt = Number(job.timestamp);
        if (Number.isFinite(processedAt) && Number.isFinite(enqueuedAt)) {
          this.queueWaitDuration.observe(
            { queue: queueName },
            Math.max(0, (processedAt - enqueuedAt) / 1000),
          );
        }

        if (!Number.isFinite(processedAt)) return;
        const finishedAt = Number(job.finishedOn) || Date.now();
        this.jobProcessingDuration.observe(
          {
            queue: queueName,
            outcome: event === 'completed' ? 'completed' : 'failed_attempt',
          },
          Math.max(0, (finishedAt - processedAt) / 1000),
        );
      })
      .catch((error: unknown) => {
        this.logQueueError(
          queueName,
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  }

  private logQueueError(queueName: string, error: Error): void {
    const now = Date.now();
    const previous = this.lastErrorLoggedAt.get(queueName) ?? 0;
    if (now - previous < ERROR_LOG_INTERVAL_MS) return;
    this.lastErrorLoggedAt.set(queueName, now);
    this.logger.warn(
      `BullMQ metrics unavailable for queue=${queueName}: ${error.message}`,
    );
  }
}
