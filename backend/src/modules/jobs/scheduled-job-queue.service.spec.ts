import { ScheduledJobQueueService } from './scheduled-job-queue.service';

describe('ScheduledJobQueueService', () => {
  it('degrades to the application scheduler without Redis', async () => {
    const service = new ScheduledJobQueueService({
      get: () => undefined,
    } as any);
    expect(service.enabled).toBe(false);
    expect(await service.enqueue('job-1', 'trigger-1')).toBe(false);
    await service.onModuleDestroy();
  });
});
