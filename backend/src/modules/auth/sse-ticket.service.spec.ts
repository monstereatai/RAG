import { SseTicketService } from './sse-ticket.service';

describe('SseTicketService', () => {
  it('preserves API Token scope identity in a one-time ticket', async () => {
    const setRequired = jest
      .fn<Promise<boolean>, [string, string, number?]>()
      .mockResolvedValue(true);
    const redis = {
      setRequired,
      getdel: jest.fn(),
    };
    const service = new SseTicketService(redis as never);

    await service.issue({
      userId: 'user-1',
      username: 'user-1',
      role: 'user',
      tenantId: 'tenant-a',
      authType: 'api-token',
      scopes: ['rag:chat'],
    });

    const payload = JSON.parse(setRequired.mock.calls[0]?.[1] ?? '') as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      userId: 'user-1',
      tenantId: 'tenant-a',
      authType: 'api-token',
      scopes: ['rag:chat'],
      type: 'access',
    });
  });
});
