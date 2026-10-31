import { ConfigService } from '@nestjs/config';
import { ScheduledJobQueueService } from './scheduled-job-queue.service';

describe('ScheduledJobQueueService', () => {
  it('degrades to the application scheduler without Redis', async () => {
    const service = new ScheduledJobQueueService({
      get: () => undefined,
    } as unknown as ConfigService);
    expect(service.enabled).toBe(false);
    expect(await service.enqueue('job-1', 'trigger-1')).toBe(false);
    await service.onModuleDestroy();
  });

  it('builds a stable BullMQ id without forbidden separators', () => {
    const service = new ScheduledJobQueueService({
      get: () => undefined,
    } as unknown as ConfigService);
    const internals = service as unknown as {
      queueJobId: (jobId: string, triggerKey: string) => string;
    };
    const first = internals.queueJobId.call(
      service,
      'job-1',
      'scheduler:job-1',
    );

    expect(first).toMatch(/^scheduled-job-[a-f0-9]{32}$/);
    expect(first).not.toContain(':');
    expect(first).toBe(
      internals.queueJobId.call(service, 'job-1', 'scheduler:job-1'),
    );
  });
});
