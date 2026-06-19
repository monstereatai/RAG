import { SchedulerRegistry } from '@nestjs/schedule';
import { JobsService } from './jobs.service';

describe('JobsService', () => {
  let service: JobsService;
  let scheduler: SchedulerRegistry;

  beforeEach(() => {
    jest.useFakeTimers();
    scheduler = new SchedulerRegistry();
    service = new JobsService(scheduler);
  });

  afterEach(() => {
    for (const job of service.list()) {
      service.delete(job.id);
    }
    jest.useRealTimers();
  });

  it('creates and stops an every job', () => {
    const job = service.create({
      type: 'every',
      everyMs: 1000,
      instruction: 'run every second',
    });

    expect(job.enabled).toBe(true);
    expect(job.running).toBe(true);
    expect(scheduler.getIntervals()).toContain(job.id);

    const stopped = service.stop(job.id);

    expect(stopped.enabled).toBe(false);
    expect(stopped.running).toBe(false);
    expect(scheduler.getIntervals()).not.toContain(job.id);
  });

  it('creates an at job and disables it after running once', () => {
    const now = new Date('2026-06-19T00:00:00.000Z');
    jest.setSystemTime(now);
    const job = service.create({
      type: 'at',
      at: new Date(now.getTime() + 1000).toISOString(),
      instruction: 'run once',
    });

    expect(scheduler.getTimeouts()).toContain(job.id);

    jest.advanceTimersByTime(1000);

    const updated = service.get(job.id);
    expect(updated.enabled).toBe(false);
    expect(updated.running).toBe(false);
    expect(updated.lastRun).toBeDefined();
  });

  it('rejects invalid every jobs', () => {
    expect(() =>
      service.create({
        type: 'every',
        everyMs: 10,
        instruction: 'too frequent',
      }),
    ).toThrow('type=every requires everyMs >= 1000');
  });
});
