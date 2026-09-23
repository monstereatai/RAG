import { SpeechTicketService } from './speech-ticket.service';

describe('SpeechTicketService', () => {
  it('stores a speech-purpose ticket briefly and consumes it once', async () => {
    let value: string | null = null;
    const redis = {
      setRequired: jest.fn(async (_key: string, next: string, ttl: number) => {
        value = next;
        expect(ttl).toBe(30);
        return true;
      }),
      getdel: jest.fn(async () => {
        const current = value;
        value = null;
        return current;
      }),
    };
    const service = new SpeechTicketService(redis as never);
    const issued = await service.issue({
      userId: 'owner-1',
      username: 'owner',
      role: 'user',
      tenantId: 'tenant-1',
      authType: 'service',
      scopes: ['rag:speech'],
      type: 'access',
    });

    expect(issued.expiresIn).toBe(30);
    await expect(service.consume(issued.ticket)).resolves.toMatchObject({
      userId: 'owner-1',
      tenantId: 'tenant-1',
      scopes: ['rag:speech'],
    });
    await expect(service.consume(issued.ticket)).resolves.toBeNull();
    expect(redis.getdel).toHaveBeenCalledTimes(2);
  });
});
