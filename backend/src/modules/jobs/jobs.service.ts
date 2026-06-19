import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { randomUUID } from 'node:crypto';
import type { CreateJobInput, ScheduledJob } from './job.types';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly jobs = new Map<string, ScheduledJob>();

  constructor(private readonly schedulerRegistry: SchedulerRegistry) {}

  list(): ScheduledJob[] {
    return Array.from(this.jobs.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  create(input: CreateJobInput): ScheduledJob {
    this.validateInput(input);

    const now = new Date().toISOString();
    const job: ScheduledJob = {
      id: randomUUID(),
      type: input.type,
      instruction: input.instruction,
      enabled: input.enabled ?? true,
      running: false,
      cron: input.cron,
      everyMs: input.everyMs,
      at: input.at,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(job.id, job);
    if (job.enabled) {
      this.start(job.id);
    }
    return this.get(job.id);
  }

  get(id: string): ScheduledJob {
    const job = this.jobs.get(id);
    if (!job) {
      throw new BadRequestException(`job ${id} not found`);
    }
    return { ...job };
  }

  start(id: string): ScheduledJob {
    const job = this.getMutable(id);
    if (job.running) return { ...job };

    if (job.type === 'cron') {
      this.startCron(job);
    } else if (job.type === 'every') {
      this.startInterval(job);
    } else {
      this.startTimeout(job);
    }

    job.enabled = true;
    job.running = true;
    job.updatedAt = new Date().toISOString();
    return { ...job };
  }

  stop(id: string): ScheduledJob {
    const job = this.getMutable(id);
    this.stopRuntime(job);
    job.enabled = false;
    job.running = false;
    job.updatedAt = new Date().toISOString();
    return { ...job };
  }

  delete(id: string): ScheduledJob {
    const job = this.getMutable(id);
    this.stopRuntime(job);
    this.jobs.delete(id);
    return { ...job, enabled: false, running: false };
  }

  private getMutable(id: string): ScheduledJob {
    const job = this.jobs.get(id);
    if (!job) {
      throw new BadRequestException(`job ${id} not found`);
    }
    return job;
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

  private startCron(job: ScheduledJob): void {
    const cronExpr = job.cron ?? '';
    const runtime = new CronJob(cronExpr, () => this.run(job.id));
    this.schedulerRegistry.addCronJob(job.id, runtime);
    runtime.start();
  }

  private startInterval(job: ScheduledJob): void {
    const everyMs = job.everyMs ?? 0;
    const ref = setInterval(() => this.run(job.id), everyMs);
    this.schedulerRegistry.addInterval(job.id, ref);
  }

  private startTimeout(job: ScheduledJob): void {
    const at = new Date(job.at ?? '');
    const delay = Math.max(0, at.getTime() - Date.now());
    const ref = setTimeout(() => {
      void this.run(job.id);
      const current = this.jobs.get(job.id);
      if (current) {
        current.enabled = false;
        current.running = false;
        current.updatedAt = new Date().toISOString();
      }
      this.safeDeleteTimeout(job.id);
    }, delay);
    this.schedulerRegistry.addTimeout(job.id, ref);
  }

  private run(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.lastRun = new Date().toISOString();
    job.updatedAt = job.lastRun;
    this.logger.log(`scheduled job ${job.id}: ${job.instruction}`);
  }

  private stopRuntime(job: ScheduledJob): void {
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
}
