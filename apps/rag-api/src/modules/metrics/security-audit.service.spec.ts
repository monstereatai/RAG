import { SecurityAuditService } from './security-audit.service';

describe('SecurityAuditService', () => {
  it('persists only a hashed query through the domain event outbox', async () => {
    let emittedEvent:
      | { eventType: string; payload: Record<string, unknown> }
      | undefined;
    const emit = jest.fn(
      (event: { eventType: string; payload: Record<string, unknown> }) => {
        emittedEvent = event;
        return Promise.resolve(undefined);
      },
    );
    const service = new SecurityAuditService({ emit } as never);
    service.record({
      pattern: 'database_destructive_operation',
      route: 'chat',
      userId: 'u1',
      query: 'drop database secret',
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(emittedEvent?.eventType).toBe('security.query_blocked');
    expect(emittedEvent?.payload.query).toBeUndefined();
    expect(emittedEvent?.payload.queryHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
