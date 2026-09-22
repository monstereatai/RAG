import { DomainEventsService } from './domain-events.service';

describe('DomainEventsService', () => {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'domainEvents.requireDistributedLock') return true;
      if (key === 'domainEvents.lockTtlSeconds') return 60;
      return undefined;
    }),
  } as any;

  function createService(
    redisOverrides: Partial<Record<string, jest.Mock>> = {},
  ) {
    const outbox = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    } as any;
    const subscriptions = { find: jest.fn().mockResolvedValue([]) } as any;
    const redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      setIfAbsent: jest.fn(),
      renewLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
      ...redisOverrides,
    } as any;
    return {
      service: new DomainEventsService(config, outbox, subscriptions, redis),
      outbox,
      redis,
    };
  }

  it('treats a concurrent unique-key insert as an idempotent success', async () => {
    const { service, outbox } = createService();
    outbox.save.mockRejectedValueOnce({ code: '23505' });

    await expect(
      service.emit({
        eventType: 'test.created',
        aggregateType: 'test',
        aggregateId: '1',
      }),
    ).resolves.toBeUndefined();
  });

  it('writes the outbox record through the caller transaction manager', async () => {
    const { service } = createService();
    const transactionalOutbox = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(transactionalOutbox),
    };

    await service.emitInTransaction(manager as never, {
      eventType: 'document.effective',
      aggregateType: 'document',
      aggregateId: 'doc-1',
    });

    expect(manager.getRepository).toHaveBeenCalled();
    expect(transactionalOutbox.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'document.effective',
        aggregateId: 'doc-1',
      }),
    );
  });

  it('does not dispatch without the required distributed lock', async () => {
    const { service, outbox } = createService();
    await (service as any).dispatchPending();
    expect(outbox.find).not.toHaveBeenCalled();
  });

  it('releases the dispatch lock after processing a batch', async () => {
    const { service, redis, outbox } = createService({
      isEnabled: jest.fn().mockReturnValue(true),
      setIfAbsent: jest.fn().mockResolvedValue(true),
    });
    await (service as any).dispatchPending();
    expect(outbox.find).toHaveBeenCalled();
    expect(redis.releaseLock).toHaveBeenCalledWith(
      'rag:domain-events:dispatch-lock',
      expect.any(String),
    );
  });
});
