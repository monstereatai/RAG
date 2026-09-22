import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronJob, CronTime } from 'cron';
import { randomUUID } from 'node:crypto';
import { ScheduledJobEntity } from '../../providers/db/entities/job.entity';
import { JobExecutionEntity } from '../../providers/db/entities/job-execution.entity';
import type { CreateJobInput } from './job.types';
import { SupervisorService } from '../supervisor/supervisor.service';
import { ScheduledAnalysisService } from './scheduled-analysis.service';
import { MetricsService } from '../metrics/metrics.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { ScheduledJobQueueService } from './scheduled-job-queue.service';

const SCHEDULE_TIMEZONE = 'Asia/Shanghai';

@Injectable()
export class JobsService implements OnModuleInit {
  private readonly logger = new Logger(JobsService.name);
  private readonly executingJobs = new Set<string>();

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    @InjectRepository(ScheduledJobEntity)
    private readonly jobRepo: Repository<ScheduledJobEntity>,
    @InjectRepository(JobExecutionEntity)
    private readonly executionRepo: Repository<JobExecutionEntity>,
    private readonly supervisorService: SupervisorService,
    private readonly scheduledAnalysis: ScheduledAnalysisService,
    private readonly metricsService: MetricsService,
    private readonly domainEvents: DomainEventsService,
    private readonly redisProvider: RedisProvider,
    @Optional() private readonly scheduledQueue?: ScheduledJobQueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.scheduledQueue?.setProcessor(async (jobId) => {
      const execution = await this.run(jobId);
      const current = await this.jobRepo.findOneBy({ id: jobId });
      if (current?.type === 'at' && execution.status === 'completed') {
        current.enabled = false;
        current.running = false;
        current.nextRunAt = null;
        await this.jobRepo.save(current);
      }
    });
    try {
      const activeJobs = await this.jobRepo.find({ where: { enabled: true } });
      this.logger.log(
        `Restoring ${activeJobs.length} active scheduled jobs...`,
      );
      for (const job of activeJobs) {
        try {
          await this.startRuntime(job);
          job.running = true;
          await this.jobRepo.save(job);
        } catch (err) {
          this.logger.warn(
            `Failed to restore job ${job.id}: ${(err as Error).message}`,
          );
          job.running = false;
          await this.jobRepo.save(job);
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to query active jobs: ${(err as Error).message}`,
      );
    }
  }

  async list(): Promise<ScheduledJobEntity[]> {
    return this.jobRepo.find({
      order: { createdAt: 'DESC' },
    });
  }

  async listAnalysis(): Promise<ScheduledJobEntity[]> {
    return this.jobRepo.find({
      where: { taskKind: 'analysis', isCurrent: true },
      order: { createdAt: 'DESC' },
    });
  }

  /** 获取某任务的执行历史 */
  async getExecutions(
    jobId: string,
    limit = 20,
  ): Promise<JobExecutionEntity[]> {
    return this.executionRepo.find({
      where: { jobId },
      order: { startedAt: 'DESC' },
      take: limit,
    });
  }

  async create(input: CreateJobInput): Promise<ScheduledJobEntity> {
    this.validateInput(input);
    this.ensureSchedulingBackend();

    const job = this.jobRepo.create({
      id: randomUUID(),
      type: input.type,
      instruction: input.instruction,
      name: input.name?.trim() || null,
      taskKind: input.taskKind ?? 'agent',
      sourceType: input.sourceType ?? 'natural_language',
      analysisConfig: JSON.stringify(input.analysisConfig ?? {}),
      versionGroupId: input.versionGroupId ?? randomUUID(),
      version: input.version ?? 1,
      isCurrent: input.isCurrent ?? true,
      copiedFromId: input.copiedFromId ?? null,
      userId: input.userId ?? null,
      enabled: input.enabled ?? true,
      running: false,
      cron: input.cron || null,
      everyMs: input.everyMs || null,
      at: input.at || null,
    });

    await this.jobRepo.save(job);

    if (job.enabled) {
      await this.start(job.id);
    }

    return this.get(job.id);
  }

  async get(id: string): Promise<ScheduledJobEntity> {
    const job = await this.jobRepo.findOneBy({ id });
    if (!job) {
      throw new BadRequestException(`job ${id} not found`);
    }
    return job;
  }

  async start(id: string): Promise<ScheduledJobEntity> {
    const job = await this.get(id);
    if (job.running) return job;

    this.ensureSchedulingBackend();
    await this.startRuntime(job);

    await this.deactivateOtherVersions(job);

    job.enabled = true;
    job.running = true;
    job.isCurrent = true;
    job.updatedAt = new Date();

    await this.jobRepo.save(job);
    return job;
  }

  async listVersions(id: string): Promise<ScheduledJobEntity[]> {
    const job = await this.get(id);
    const groupId = job.versionGroupId ?? job.id;
    const versions = await this.jobRepo.find({
      where: { versionGroupId: groupId },
    });
    return versions
      .filter((item) => (item.versionGroupId ?? item.id) === groupId)
      .sort((a, b) => (b.version ?? 1) - (a.version ?? 1));
  }

  async copy(id: string): Promise<ScheduledJobEntity> {
    const source = await this.get(id);
    const groupId = source.versionGroupId ?? source.id;
    const versions = await this.listVersions(id);
    const nextVersion =
      Math.max(...versions.map((item) => item.version ?? 1), 1) + 1;
    const copied = this.jobRepo.create({
      ...source,
      id: randomUUID(),
      versionGroupId: groupId,
      version: nextVersion,
      isCurrent: false,
      copiedFromId: source.id,
      enabled: false,
      running: false,
      lastRun: null,
      lastResult: null,
      lastError: null,
      lastDurationMs: null,
      nextRunAt: null,
    });
    await this.jobRepo.save(copied);
    return copied;
  }

  parseAnalysisDefinition(
    sourceText: string,
    sourceType: 'natural_language' | 'markdown',
  ) {
    return this.scheduledAnalysis.parseDefinition(sourceText, sourceType);
  }

  async runNow(id: string): Promise<JobExecutionEntity> {
    return this.run(id);
  }

  async stop(id: string): Promise<ScheduledJobEntity> {
    const job = await this.get(id);
    await this.stopRuntime(job);

    job.enabled = false;
    job.running = false;
    job.updatedAt = new Date();

    await this.jobRepo.save(job);
    return job;
  }

  async delete(id: string): Promise<ScheduledJobEntity> {
    const job = await this.get(id);
    await this.stopRuntime(job);
    await this.jobRepo.remove(job);
    return { ...job, enabled: false, running: false };
  }

  private validateInput(input: CreateJobInput): void {
    if (input.type === 'cron') {
      if (!input.cron) {
        throw new BadRequestException('type=cron requires cron');
      }
      const validation = CronTime.validateCronExpression(input.cron);
      if (!validation.valid) {
        throw new BadRequestException(
          `invalid cron expression: ${validation.error?.message ?? '无法解析'}`,
        );
      }
    }
    if (input.type === 'every' && (!input.everyMs || input.everyMs < 1000)) {
      throw new BadRequestException('type=every requires everyMs >= 1000');
    }
    if (input.type === 'at') {
      if (!input.at) {
        throw new BadRequestException('type=at requires at');
      }
      const date = new Date(input.at);
      if (Number.isNaN(date.getTime())) {
        throw new BadRequestException('type=at requires valid ISO at');
      }
      if (date.getTime() <= Date.now()) {
        throw new BadRequestException('type=at must be later than now');
      }
    }
  }

  private async startRuntime(job: ScheduledJobEntity): Promise<void> {
    // 模块启动恢复、创建、启动和重启都必须经过同一个持久队列门禁；否则
    // onModuleInit 会在 Redis 缺失时悄悄恢复为当前进程的 cron／timer。
    this.ensureSchedulingBackend();
    if (this.scheduledQueue?.enabled) {
      await this.scheduledQueue.schedule(job);
      return;
    }
    if (job.type === 'cron') {
      this.startCron(job);
    } else if (job.type === 'every') {
      this.startInterval(job);
    } else {
      this.startTimeout(job);
    }
  }

  private ensureSchedulingBackend(): void {
    if (
      this.scheduledQueue?.required === true &&
      !this.scheduledQueue.enabled
    ) {
      throw new BadRequestException(
        '生产定时任务要求 Redis 持久队列可用，当前不可用，已拒绝进程内降级。',
      );
    }
  }

  private async deactivateOtherVersions(
    job: ScheduledJobEntity,
  ): Promise<void> {
    const groupId = job.versionGroupId ?? job.id;
    const versions = await this.jobRepo.find({
      where: { versionGroupId: groupId },
    });
    for (const other of versions) {
      if (other.id === job.id || (other.versionGroupId ?? other.id) !== groupId)
        continue;
      if (other.running || other.enabled || other.isCurrent)
        await this.stopRuntime(other);
      other.enabled = false;
      other.running = false;
      other.isCurrent = false;
      await this.jobRepo.save(other);
    }
  }

  private startCron(job: ScheduledJobEntity): void {
    const cronExpr = job.cron ?? '';
    const runtime = new CronJob(
      cronExpr,
      () => {
        void this.dispatch(job.id, `cron:${new Date().toISOString()}`).catch(
          (error) =>
            this.logger.warn(
              `scheduled job ${job.id} callback failed: ${(error as Error).message}`,
            ),
        );
      },
      null,
      false,
      SCHEDULE_TIMEZONE,
    );
    this.schedulerRegistry.addCronJob(job.id, runtime);
    runtime.start();

    // Compute next run time
    job.nextRunAt = runtime.nextDate()?.toJSDate() ?? null;
    this.jobRepo.save(job).catch(() => {});
  }

  private startInterval(job: ScheduledJobEntity): void {
    const everyMs = job.everyMs ?? 0;
    const ref = setInterval(() => {
      void this.dispatch(job.id, `every:${Date.now()}`).catch((error) =>
        this.logger.warn(
          `scheduled job ${job.id} callback failed: ${(error as Error).message}`,
        ),
      );
    }, everyMs);
    this.schedulerRegistry.addInterval(job.id, ref);

    job.nextRunAt = new Date(Date.now() + everyMs);
    this.jobRepo.save(job).catch(() => {});
  }

  private startTimeout(job: ScheduledJobEntity): void {
    const at = new Date(job.at ?? '');
    const delay = Math.max(0, at.getTime() - Date.now());
    const ref = setTimeout(() => {
      void this.dispatch(job.id, `at:${job.at}`)
        .then(async (execution) => {
          if (execution && execution.status === 'completed') {
            const current = await this.jobRepo.findOneBy({ id: job.id });
            if (current) {
              current.enabled = false;
              current.running = false;
              current.nextRunAt = null;
              await this.jobRepo.save(current);
            }
          }
          this.safeDeleteTimeout(job.id);
        })
        .catch(() => undefined);
    }, delay);
    this.schedulerRegistry.addTimeout(job.id, ref);

    job.nextRunAt = at;
    this.jobRepo.save(job).catch(() => {});
  }

  private async dispatch(
    id: string,
    triggerKey: string,
    delayMs = 0,
  ): Promise<JobExecutionEntity | null> {
    if (await this.scheduledQueue?.enqueue(id, triggerKey, delayMs))
      return null;
    return this.run(id);
  }

  private async run(id: string): Promise<JobExecutionEntity> {
    const job = await this.jobRepo.findOneBy({ id });
    if (!job) throw new BadRequestException(`job ${id} not found`);
    if (this.executingJobs.has(id)) {
      throw new BadRequestException(`job ${id} is already running`);
    }
    const lockKey = `rag:scheduled-job:${id}:lock`;
    const lockToken = randomUUID();
    if (
      !this.redisProvider.isEnabled() &&
      process.env.REQUIRE_DISTRIBUTED_LOCK === 'true'
    ) {
      throw new BadRequestException(
        'Redis 分布式锁不可用，生产模式拒绝执行定时任务副作用。',
      );
    }
    const distributedLock = this.redisProvider.isEnabled()
      ? await this.redisProvider.setIfAbsent(lockKey, lockToken, 180)
      : true;
    if (!distributedLock) {
      throw new BadRequestException(
        `job ${id} is already running on another instance`,
      );
    }
    this.executingJobs.add(id);

    const now = new Date();
    const startedAt = Date.now();
    const executionId = randomUUID();

    // Create execution record
    const execution = this.executionRepo.create({
      id: executionId,
      jobId: job.id,
      status: 'running',
      startedAt: now,
    });
    await this.executionRepo.save(execution);

    try {
      let resultSummary: string;
      if (job.taskKind === 'analysis') {
        const result = await this.withRetry(
          () =>
            this.withTimeout(
              this.scheduledAnalysis.execute(job),
              120_000,
              `scheduled analysis job ${job.id}`,
            ),
          2,
        );
        resultSummary = result.markdown;
      } else {
        const result = await this.withRetry(
          () =>
            this.withTimeout(
              this.supervisorService.query(job.instruction),
              30_000,
              `scheduled job ${job.id}`,
            ),
          2,
        );
        resultSummary = `domain=${result.domain}, confidence=${result.confidence.toFixed(2)}\n\n${result.answer}`;
      }
      const durationMs = Date.now() - startedAt;

      // Update job record
      job.lastRun = now.toISOString();
      job.lastResult = resultSummary;
      job.lastError = null;
      job.lastDurationMs = durationMs;
      job.updatedAt = now;
      await this.jobRepo.save(job);

      // Update execution record
      execution.status = 'completed';
      execution.result = resultSummary;
      execution.durationMs = durationMs;
      await this.executionRepo.save(execution);

      this.logger.log(
        `scheduled job ${job.id} completed (${resultSummary.length} chars)`,
      );
      this.metricsService.observeScheduledJob(
        job.taskKind,
        'completed',
        durationMs / 1000,
      );
      await this.refreshNextRun(job);
      await this.domainEvents.emit({
        eventType: 'job.completed',
        aggregateType: 'scheduled_job',
        aggregateId: job.id,
        payload: { executionId, taskKind: job.taskKind, durationMs },
      });
      return execution;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const errorMsg = (err as Error).message;

      // Update job record
      job.lastRun = now.toISOString();
      job.lastResult = null;
      job.lastError = errorMsg;
      job.lastDurationMs = durationMs;
      job.updatedAt = now;
      await this.jobRepo.save(job);

      // Update execution record
      execution.status = 'failed';
      execution.errorMessage = errorMsg;
      execution.durationMs = durationMs;
      await this.executionRepo.save(execution);

      this.logger.warn(`scheduled job ${job.id} failed: ${errorMsg}`);
      this.metricsService.observeScheduledJob(
        job.taskKind,
        'failed',
        durationMs / 1000,
      );
      await this.domainEvents.emit({
        eventType: 'job.failed',
        aggregateType: 'scheduled_job',
        aggregateId: job.id,
        payload: {
          executionId,
          taskKind: job.taskKind,
          durationMs,
          reason: errorMsg,
        },
      });
      return execution;
    } finally {
      this.executingJobs.delete(id);
      if (this.redisProvider.isEnabled()) {
        await this.redisProvider.releaseLock(lockKey, lockToken);
      }
    }
  }

  private async refreshNextRun(job: ScheduledJobEntity): Promise<void> {
    if (this.scheduledQueue?.enabled) {
      await this.scheduledQueue.schedule(job);
      return;
    }
    if (job.type === 'cron') {
      job.nextRunAt =
        this.schedulerRegistry
          .getCronJobs()
          .get(job.id)
          ?.nextDate()
          ?.toJSDate() ?? null;
    } else if (job.type === 'every') {
      job.nextRunAt = new Date(Date.now() + (job.everyMs ?? 0));
    }
    await this.jobRepo.save(job);
  }

  private async stopRuntime(job: ScheduledJobEntity): Promise<void> {
    if (this.scheduledQueue?.enabled) {
      await this.scheduledQueue.unschedule(job.id);
      return;
    }
    if (job.type === 'cron') {
      const runtime = this.schedulerRegistry.getCronJobs().get(job.id);
      void runtime?.stop();
      this.safeDeleteCron(job.id);
    } else if (job.type === 'every') {
      this.safeDeleteInterval(job.id);
    } else {
      this.safeDeleteTimeout(job.id);
    }
  }

  private safeDeleteCron(id: string): void {
    try {
      this.schedulerRegistry.deleteCronJob(id);
    } catch {
      // already absent
    }
  }

  private safeDeleteInterval(id: string): void {
    try {
      this.schedulerRegistry.deleteInterval(id);
    } catch {
      // already absent
    }
  }

  private safeDeleteTimeout(id: string): void {
    try {
      this.schedulerRegistry.deleteTimeout(id);
    } catch {
      // already absent
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timeout after ${ms}ms`)),
        ms,
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    attempts: number,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
