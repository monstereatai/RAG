import { SecurityAuditService } from './security-audit.service';

describe('SecurityAuditService', () => {
  it('persists only a hashed query through the domain event outbox', async () => {
    const emit = jest.fn().mockResolvedValue(undefined);
    const service = new SecurityAuditService({ emit } as any);
    service.record({
      pattern: 'database_destructive_operation',
      route: 'chat',
      userId: 'u1',
      query: 'drop database secret',
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'security.query_blocked',
        payload: expect.not.objectContaining({ query: expect.any(String) }),
      }),
    );
    expect(emit.mock.calls[0][0].payload.queryHash).toHaveLength(64);
  });
});
