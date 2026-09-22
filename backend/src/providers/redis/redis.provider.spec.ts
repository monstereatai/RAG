import { RedisProvider } from './redis.provider';

describe('RedisProvider', () => {
  it('uses an atomic Lua read-delete fallback when GETDEL is unavailable', async () => {
    const client = {
      getdel: jest.fn().mockRejectedValue(new Error('unknown command')),
      eval: jest.fn().mockResolvedValue('payload'),
      get: jest.fn(),
      del: jest.fn(),
    };
    const provider = new RedisProvider({ get: jest.fn() } as never);
    Object.assign(provider, { client, enabled: true });

    await expect(provider.getdel('sse-ticket:key')).resolves.toBe('payload');
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get', KEYS[1])"),
      1,
      'sse-ticket:key',
    );
    expect(client.get).not.toHaveBeenCalled();
    expect(client.del).not.toHaveBeenCalled();
  });

  it('surfaces strict persistence failures instead of returning an empty value', async () => {
    const client = {
      get: jest.fn().mockRejectedValue(new Error('connection lost')),
    };
    const provider = new RedisProvider({ get: jest.fn() } as never);
    Object.assign(provider, { client, enabled: true });

    await expect(provider.getRequired('checkpoint:key')).rejects.toThrow(
      'connection lost',
    );
    expect(provider.isEnabled()).toBe(false);
  });
});
