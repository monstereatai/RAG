import { AgentRuntimeEventsService } from './agent-runtime-events.service';

describe('AgentRuntimeEventsService', () => {
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
    expect((service as any).threadQueues.has('thread-a')).toBe(false);
  });

  it('allocates MySQL event sequences and reads the value on the same connection', async () => {
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ nextSequence: 42 }]),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AgentRuntimeEventsService(
      {} as never,
      {
        options: { type: 'mysql' },
        createQueryRunner: jest.fn().mockReturnValue(runner),
      } as never,
    );

    await expect(
      (service as any).nextSequence('tenant-a', 'thread-a'),
    ).resolves.toBe(42);
    expect(runner.query).toHaveBeenCalledTimes(2);
    expect(runner.query.mock.calls[0][0]).toContain('LAST_INSERT_ID');
    expect(runner.query.mock.calls[1][0]).toContain('SELECT LAST_INSERT_ID()');
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
