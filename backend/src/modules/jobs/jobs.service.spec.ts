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
  let mockSupervisorService: any;
  let mockScheduledAnalysis: any;

  beforeEach(() => {
    jest.useFakeTimers();
    scheduler = new SchedulerRegistry();
    mockJobsMap = new Map();
    mockJobRepo = {
      create: jest.fn().mockImplementation((dto) => {
        return {
          ...dto,
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
    const mockExecutionRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockResolvedValue([]),
    };
    mockSupervisorService = {
      query: jest.fn().mockResolvedValue({
        domain: 'technical',
        confidence: 0.8,
        answer: 'done',
      }),
    };
    mockScheduledAnalysis = {
      parseDefinition: jest.fn().mockReturnValue({
        name: '每日规则报告',
        type: 'cron',
        cron: '0 9 * * *',
      }),
      execute: jest.fn().mockResolvedValue({
        markdown: '# 每日规则报告',
        snapshot: {},
      }),
    };
    service = new JobsService(
      scheduler,
      mockJobRepo,
      mockExecutionRepo as any,
      mockSupervisorService,
      mockScheduledAnalysis,
      { observeScheduledJob: jest.fn() } as any,
      { emit: jest.fn() } as any,
    );
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
    expect(mockSupervisorService.query).toHaveBeenCalledWith('run once');
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

  it('executes an analysis job and persists its markdown report', async () => {
    const job = await service.create({
      name: '每日规则报告',
      taskKind: 'analysis',
      sourceType: 'natural_language',
      type: 'cron',
      cron: '0 9 * * *',
      instruction: '每天统计最新规则',
      analysisConfig: {
        window: 'today',
        dataScopes: ['rules'],
        roles: ['产品'],
        departments: ['产品部'],
      },
      enabled: false,
    });

    const execution = await service.runNow(job.id);

    expect(mockScheduledAnalysis.execute).toHaveBeenCalled();
    expect(execution.status).toBe('completed');
    expect(execution.result).toContain('每日规则报告');
    expect(mockSupervisorService.query).not.toHaveBeenCalled();
  });

  it('copies a task as a disabled next version and switches versions on start', async () => {
    const first = await service.create({ name: '规则报告', taskKind: 'analysis', type: 'cron', cron: '0 9 * * *', instruction: '每天统计规则', enabled: false });
    const copied = await service.copy(first.id);
    expect(copied.version).toBe(2);
    expect(copied.versionGroupId).toBe(first.versionGroupId);
    expect(copied.enabled).toBe(false);
    await service.start(copied.id);
    const old = await service.get(first.id);
    const current = await service.get(copied.id);
    expect(old.isCurrent).toBe(false);
    expect(old.enabled).toBe(false);
    expect(current.isCurrent).toBe(true);
    expect(current.running).toBe(true);
  });
});
