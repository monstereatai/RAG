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
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
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

  it('keeps implicit idempotency distinct for later aggregate transitions', async () => {
    const { service, outbox } = createService();

    await service.emit({
      eventType: 'document.lifecycle_changed',
      aggregateType: 'document',
      aggregateId: 'doc-1',
      payload: { lifecycleStatus: 'archived' },
    });
    await service.emit({
      eventType: 'document.lifecycle_changed',
      aggregateType: 'document',
      aggregateId: 'doc-1',
      payload: { lifecycleStatus: 'effective' },
    });

    const first = outbox.create.mock.calls[0][0];
    const second = outbox.create.mock.calls[1][0];
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it('retries only failed subscription deliveries', async () => {
    const { outbox, redis, subscriptions } = (() => {
      const outbox = {
        findOneBy: jest.fn().mockResolvedValue({ id: 'event-1' }),
        save: jest.fn().mockResolvedValue(undefined),
      };
      return {
        outbox,
        subscriptions: {} as any,
        redis: {} as any,
      };
    })();
    const where = jest.fn().mockReturnThis();
    const deliveries = {
      createQueryBuilder: jest.fn().mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where,
        execute: jest.fn().mockResolvedValue(undefined),
      }),
    };
    const service = new DomainEventsService(
      config,
      outbox as never,
      subscriptions,
      redis,
      deliveries as never,
    );

    await service.retry('event-1');

    expect(where).toHaveBeenCalledWith(
      'eventId = :eventId AND status = :status',
      { eventId: 'event-1', status: 'failed' },
    );
  });

  it('redacts sensitive fields nested inside event payloads', async () => {
    const { service, outbox } = createService();

    await service.emit({
      eventType: 'test.created',
      aggregateType: 'test',
      aggregateId: '1',
      payload: {
        public: { value: 'ok' },
        nested: [{ prompt: 'hidden', token: 'hidden', value: 'kept' }],
      },
    });

    expect(outbox.create.mock.calls[0][0].payload).toBe(
      JSON.stringify({ public: { value: 'ok' }, nested: [{ value: 'kept' }] }),
    );
  });

  it('does not dispatch without the required distributed lock', async () => {
    const { service, outbox } = createService();
    await (service as any).dispatchPending();
    expect(outbox.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('releases the dispatch lock after processing a batch', async () => {
    const { service, redis, outbox } = createService({
      isEnabled: jest.fn().mockReturnValue(true),
      setIfAbsent: jest.fn().mockResolvedValue(true),
    });
    await (service as any).dispatchPending();
    expect(outbox.createQueryBuilder).toHaveBeenCalled();
    expect(redis.releaseLock).toHaveBeenCalledWith(
      'rag:domain-events:dispatch-lock',
      expect.any(String),
    );
  });

  it('does not redeliver a subscriber delivery already marked failed', async () => {
    const subscription = {
      id: 'sub-1',
      tenantId: 'tenant-1',
      eventTypes: '["document.created"]',
    };
    const delivery = {
      id: 'delivery-1',
      eventId: 'event-1',
      subscriptionId: 'sub-1',
      status: 'failed',
      attempts: 5,
      maxAttempts: 5,
    };
    const deliveries = {
      findOne: jest.fn().mockResolvedValue(delivery),
      save: jest.fn(),
    };
    const outbox = { save: jest.fn().mockResolvedValue(undefined) };
    const subscriptions = { find: jest.fn().mockResolvedValue([subscription]) };
    const service = new DomainEventsService(
      config,
      outbox as never,
      subscriptions as never,
      { isEnabled: jest.fn().mockReturnValue(false) } as never,
      deliveries as never,
    );
    const post = jest
      .spyOn(service as any, 'post')
      .mockResolvedValue(undefined);

    await (service as any).deliver({
      id: 'event-1',
      tenantId: 'tenant-1',
      eventType: 'document.created',
      aggregateType: 'document',
      aggregateId: 'doc-1',
      attempts: 5,
    });

    expect(post).not.toHaveBeenCalled();
    expect(deliveries.save).not.toHaveBeenCalled();
  });
});
