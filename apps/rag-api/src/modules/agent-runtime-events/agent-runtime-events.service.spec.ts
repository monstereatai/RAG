import { AgentRuntimeEventsService } from './agent-runtime-events.service';

describe('AgentRuntimeEventsService', () => {
  it('writes a keyed event only once when a workflow side effect is replayed', async () => {
    let stored: Record<string, unknown> | null = null;
    const execute = jest.fn(() => Promise.resolve());
    const insert = {
      insert: () => insert,
      into: () => insert,
      values: (value: Record<string, unknown>) => {
        stored = value;
        return insert;
      },
      orIgnore: () => insert,
      execute,
    };
    const events = {
      create: jest.fn((value: Record<string, unknown>) => value),
      findOneBy: jest.fn(() => Promise.resolve(stored)),
      findOneByOrFail: jest.fn(() => Promise.resolve(stored)),
      createQueryBuilder: jest.fn().mockReturnValue(insert),
    };
    const dataSource = {
      options: { type: 'postgres' },
      query: jest.fn().mockResolvedValue([{ nextSequence: 1 }]),
    };
    const service = new AgentRuntimeEventsService(
      events as never,
      dataSource as never,
    );
    const input = {
      threadId: 'thread-a',
      eventType: 'message.published',
      actor: 'product',
      idempotencyKey: 'handoff-product-backend',
    };

    const first = await service.emit(input);
    const second = await service.emit(input);

    expect(first).toEqual(second);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });

  it('cleans a failed thread queue without creating a second unhandled rejection', async () => {
    const service = new AgentRuntimeEventsService(
      { save: jest.fn() } as never,
      {
        options: { type: 'postgres' },
        query: jest.fn().mockRejectedValue(new Error('database unavailable')),
      } as never,
    );

    await expect(
      service.emit({
        tenantId: 'tenant-a',
        threadId: 'thread-a',
        eventType: 'run.started',
        actor: 'test',
      }),
    ).rejects.toThrow('database unavailable');

    await new Promise((resolve) => setImmediate(resolve));
    const internals = service as unknown as {
      threadQueues: { has(key: string): boolean };
    };
    expect(internals.threadQueues.has('thread-a')).toBe(false);
  });

  it('allocates MySQL event sequences and reads the value on the same connection', async () => {
    const queries: string[] = [];
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((query: string) => {
        queries.push(query);
        return Promise.resolve(
          queries.length === 1 ? [] : [{ nextSequence: 42 }],
        );
      }),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AgentRuntimeEventsService(
      {} as never,
      {
        options: { type: 'mysql' },
        createQueryRunner: jest.fn().mockReturnValue(runner),
      } as never,
    );

    const internals = service as unknown as {
      nextSequence(tenantId: string, threadId: string): Promise<number>;
    };
    await expect(internals.nextSequence('tenant-a', 'thread-a')).resolves.toBe(
      42,
    );
    expect(runner.query).toHaveBeenCalledTimes(2);
    expect(queries[0]).toContain('LAST_INSERT_ID');
    expect(queries[1]).toContain('SELECT LAST_INSERT_ID()');
    expect(runner.release).toHaveBeenCalled();
  });

  it('returns the newest bounded page in ascending sequence order', async () => {
    const events = {
      find: jest.fn().mockResolvedValue([
        { sequence: 8, payload: '{}' },
        { sequence: 7, payload: '{}' },
      ]),
    };
    const service = new AgentRuntimeEventsService(events as never, {} as never);

    const rows = await service.list('thread-a', undefined, 'tenant-a', 10, 2);

    expect(events.find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { sequence: 'DESC' }, take: 2 }),
    );
    expect(rows.map((row) => row.sequence)).toEqual([7, 8]);
  });
});
