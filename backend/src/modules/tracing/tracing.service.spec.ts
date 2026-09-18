import { TracingService } from './tracing.service';

describe('TracingService agent node traces', () => {
  it('groups nodes by thread and isolates different threads', () => {
    const service = new TracingService();
    const first = service.recordAgentNode({
      threadId: 'thread-a',
      node: 'retrieval',
      status: 'success',
      durationMs: 12.345,
      startedAt: new Date('2026-08-03T00:00:00.000Z'),
    });
    const second = service.recordAgentNode({
      threadId: 'thread-a',
      node: 'rerank',
      status: 'success',
      durationMs: 20,
      startedAt: new Date('2026-08-03T00:00:01.000Z'),
    });
    const other = service.recordAgentNode({
      threadId: 'thread-b',
      node: 'retrieval',
      status: 'error',
      durationMs: 5,
      startedAt: new Date('2026-08-03T00:00:02.000Z'),
    });

    expect(first.traceId).toBe(second.traceId);
    expect(first.traceId).not.toBe(other.traceId);
    expect(first.durationMs).toBe(12.35);
    expect(other.status).toBe(500);
  });

  it('marks traces that exceed the 15-node loop boundary', () => {
    const service = new TracingService();
    let latest;

    for (let index = 0; index < 16; index += 1) {
      latest = service.recordAgentNode({
        threadId: 'long-running-thread',
        node: `node-${index}`,
        status: 'success',
        durationMs: index,
        startedAt: new Date(),
      });
    }

    expect(latest?.alert).toBe('span_limit');
  });

  it('persists spans asynchronously when a repository is available', async () => {
    const repository = {
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };
    const service = new TracingService(repository as never);

    service.recordAgentNode({
      threadId: 'persistent-thread',
      node: 'retrieval',
      status: 'success',
      durationMs: 8,
      startedAt: new Date('2026-08-03T00:00:00.000Z'),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: expect.any(String),
        route: 'retrieval',
        kind: 'agent_node',
      }),
    );
  });
});
