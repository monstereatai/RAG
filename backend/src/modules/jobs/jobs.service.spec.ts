/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { SchedulerRegistry } from '@nestjs/schedule';
import { JobsService } from './jobs.service';

const flushPromises = () =>
  new Promise(jest.requireActual('timers').setImmediate);

describe('JobsService', () => {
  let service: JobsService;
  let scheduler: SchedulerRegistry;
  let mockJobRepo: any;
  let mockJobsMap: Map<string, any>;

  beforeEach(() => {
    jest.useFakeTimers();
    scheduler = new SchedulerRegistry();
    mockJobsMap = new Map();
    mockJobRepo = {
      create: jest.fn().mockImplementation((dto) => {
        return {
          id: dto.id,
          type: dto.type,
          instruction: dto.instruction,
          enabled: dto.enabled,
          running: dto.running,
          cron: dto.cron,
          everyMs: dto.everyMs,
          at: dto.at,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }),
      save: jest.fn().mockImplementation((entity) => {
        mockJobsMap.set(entity.id, entity);
        return Promise.resolve(entity);
      }),
      findOneBy: jest.fn().mockImplementation(({ id }) => {
        return Promise.resolve(mockJobsMap.get(id) || null);
      }),
      find: jest.fn().mockImplementation(() => {
        return Promise.resolve(Array.from(mockJobsMap.values()));
      }),
      remove: jest.fn().mockImplementation((entity) => {
        mockJobsMap.delete(entity.id);
        return Promise.resolve(entity);
      }),
    };
    service = new JobsService(scheduler, mockJobRepo);
  });

  afterEach(async () => {
    const list = await service.list();
    for (const job of list) {
      await service.delete(job.id);
    }
    jest.useRealTimers();
  });

  it('creates and stops an every job', async () => {
    const job = await service.create({
      type: 'every',
      everyMs: 1000,
      instruction: 'run every second',
    });

    expect(job.enabled).toBe(true);
    expect(job.running).toBe(true);
    expect(scheduler.getIntervals()).toContain(job.id);

    const stopped = await service.stop(job.id);

    expect(stopped.enabled).toBe(false);
    expect(stopped.running).toBe(false);
    expect(scheduler.getIntervals()).not.toContain(job.id);
  });

  it('creates an at job and disables it after running once', async () => {
    const now = new Date('2026-06-19T00:00:00.000Z');
    jest.setSystemTime(now);
    const job = await service.create({
      type: 'at',
      at: new Date(now.getTime() + 1000).toISOString(),
      instruction: 'run once',
    });

    expect(scheduler.getTimeouts()).toContain(job.id);

    jest.advanceTimersByTime(1000);
    await flushPromises();

    const updated = await service.get(job.id);
    expect(updated.enabled).toBe(false);
    expect(updated.running).toBe(false);
    expect(updated.lastRun).toBeDefined();
  });

  it('rejects invalid every jobs', async () => {
    await expect(
      service.create({
        type: 'every',
        everyMs: 10,
        instruction: 'too frequent',
      }),
    ).rejects.toThrow('type=every requires everyMs >= 1000');
  });
});
