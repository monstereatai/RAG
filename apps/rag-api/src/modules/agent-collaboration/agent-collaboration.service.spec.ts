import { AgentCollaborationService } from './agent-collaboration.service';

describe('AgentCollaborationService', () => {
  it('uses one durable message identity for a replayed workflow handoff', async () => {
    let stored: Record<string, unknown> | null = null;
    let pending: Record<string, unknown> | null = null;
    const insert = {
      insert: () => insert,
      into: () => insert,
      values: (value: Record<string, unknown>) => {
        pending = value;
        return insert;
      },
      orIgnore: () => insert,
      execute: () => {
        stored ??= pending;
        return Promise.resolve();
      },
    };
    const messages = {
      create: jest.fn((value: Record<string, unknown>) => value),
      createQueryBuilder: jest.fn().mockReturnValue(insert),
      findOneByOrFail: jest.fn(() => Promise.resolve(stored)),
    };
    const emitted: Array<{ idempotencyKey?: string }> = [];
    const events = {
      emit: jest.fn((event: { idempotencyKey?: string }) => {
        emitted.push(event);
        return Promise.resolve();
      }),
    };
    const service = new AgentCollaborationService(
      {} as never,
      messages as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      events as never,
    );
    const input = {
      threadId: 'thread-a',
      fromRole: 'product',
      toRole: 'backend',
      subject: '产品 → 后端交接',
      idempotencyKey: 'workflow:1:product:backend',
    };

    const first = await service.publishMessage(input);
    const replay = await service.publishMessage(input);

    expect(first.id).toBe(replay.id);
    expect(first.id).toHaveLength(64);
    expect(events.emit).toHaveBeenCalledTimes(2);
    expect(emitted[0].idempotencyKey).toBe(emitted[1].idempotencyKey);
  });
});
