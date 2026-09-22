import { IndexRepairQueueService } from './index-repair-queue.service';

describe('IndexRepairQueueService', () => {
  it('keeps local repair synchronous when Redis is absent in development', async () => {
    const service = new IndexRepairQueueService({
      get: () => undefined,
    } as any);

    expect(service.isEnabled()).toBe(false);
    expect(service.isRequired()).toBe(false);
    expect(
      await service.enqueue({
        id: IndexRepairQueueService.jobId('doc-1'),
        docId: 'doc-1',
        requestedBy: 'admin',
      }),
    ).toBe(false);
    await service.onModuleDestroy();
  });

  it('rejects in-process repair when strict dependencies require Redis', async () => {
    const service = new IndexRepairQueueService({
      get: (key: string) =>
        key === 'nodeEnv' ? 'production' : undefined,
    } as any);

    await expect(
      service.enqueue({
        id: IndexRepairQueueService.jobId('doc-1'),
        docId: 'doc-1',
        requestedBy: 'admin',
      }),
    ).rejects.toThrow('生产索引修复要求使用 Redis 持久队列');
    await service.onModuleDestroy();
  });

  it('creates a stable BullMQ-safe job id', () => {
    const first = IndexRepairQueueService.jobId('doc-1');
    expect(first).toMatch(/^index-repair-[a-f0-9]{32}$/);
    expect(first).not.toContain(':');
    expect(first).toBe(IndexRepairQueueService.jobId('doc-1'));
  });
});
