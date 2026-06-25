import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronJob } from 'cron';
import { randomUUID } from 'node:crypto';
import { ScheduledJobEntity } from '../../providers/db/entities/job.entity';
import { JobExecutionEntity } from '../../providers/db/entities/job-execution.entity';
import type { CreateJobInput } from './job.types';
import { SupervisorService } from '../supervisor/supervisor.service';

@Injectable()
export class JobsService implements OnModuleInit {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    @InjectRepository(ScheduledJobEntity)
    private readonly jobRepo: Repository<ScheduledJobEntity>,
    @InjectRepository(JobExecutionEntity)
    private readonly executionRepo: Repository<JobExecutionEntity>,
    private readonly supervisorService: SupervisorService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const activeJobs = await this.jobRepo.find({ where: { enabled: true } });
      this.logger.log(
        `Restoring ${activeJobs.length} active scheduled jobs...`,
      );
      for (const job of activeJobs) {
        try {
          this.startRuntime(job);
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

    const job = this.jobRepo.create({
      id: randomUUID(),
      type: input.type,
      instruction: input.instruction,
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

    this.startRuntime(job);

    job.enabled = true;
    job.running = true;
    job.updatedAt = new Date();

    await this.jobRepo.save(job);
    return job;
  }

  async stop(id: string): Promise<ScheduledJobEntity> {
    const job = await this.get(id);
    this.stopRuntime(job);

    job.enabled = false;
    job.running = false;
    job.updatedAt = new Date();

    await this.jobRepo.save(job);
    return job;
  }

  async delete(id: string): Promise<ScheduledJobEntity> {
    const job = await this.get(id);
    this.stopRuntime(job);
    await this.jobRepo.remove(job);
    return { ...job, enabled: false, running: false };
  }

  private validateInput(input: CreateJobInput): void {
    if (input.type === 'cron' && !input.cron) {
      throw new BadRequestException('type=cron requires cron');
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
    }
  }

  private startRuntime(job: ScheduledJobEntity): void {
    if (job.type === 'cron') {
      this.startCron(job);
    } else if (job.type === 'every') {
      this.startInterval(job);
    } else {
      this.startTimeout(job);
    }
  }

  private startCron(job: ScheduledJobEntity): void {
    const cronExpr = job.cron ?? '';
    const runtime = new CronJob(cronExpr, () => {
      void this.run(job.id);
    });
    this.schedulerRegistry.addCronJob(job.id, runtime);
    runtime.start();

    // Compute next run time
    job.nextRunAt = runtime.nextDate()?.toJSDate() ?? null;
    this.jobRepo.save(job).catch(() => {});
  }

  private startInterval(job: ScheduledJobEntity): void {
    const everyMs = job.everyMs ?? 0;
    const ref = setInterval(() => {
      void this.run(job.id);
    }, everyMs);
    this.schedulerRegistry.addInterval(job.id, ref);

    job.nextRunAt = new Date(Date.now() + everyMs);
    this.jobRepo.save(job).catch(() => {});
  }

  private startTimeout(job: ScheduledJobEntity): void {
    const at = new Date(job.at ?? '');
    const delay = Math.max(0, at.getTime() - Date.now());
    const ref = setTimeout(() => {
      void (async () => {
        await this.run(job.id);
        const current = await this.jobRepo.findOneBy({ id: job.id });
        if (current) {
          current.enabled = false;
          current.running = false;
          current.nextRunAt = null;
          await this.jobRepo.save(current);
        }
        this.safeDeleteTimeout(job.id);
      })();
    }, delay);
    this.schedulerRegistry.addTimeout(job.id, ref);

    job.nextRunAt = at;
    this.jobRepo.save(job).catch(() => {});
  }

  private async run(id: string): Promise<void> {
    const job = await this.jobRepo.findOneBy({ id });
    if (!job) return;

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
      const result = await this.withTimeout(
        this.supervisorService.query(job.instruction),
        30_000,
        `scheduled job ${job.id}`,
      );

      const durationMs = Date.now() - startedAt;
      const resultSummary = `domain=${result.domain}, confidence=${result.confidence.toFixed(2)}`;

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

      this.logger.log(`scheduled job ${job.id} completed: ${resultSummary}`);
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
    }
  }

  private stopRuntime(job: ScheduledJobEntity): void {
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
}
