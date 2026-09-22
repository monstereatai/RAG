import { RedisCheckpointer } from './redis-checkpointer';

describe('RedisCheckpointer', () => {
  it('keeps MemorySaver fallback for local development', async () => {
    const checkpointer = new RedisCheckpointer(
      { isEnabled: () => false } as never,
      60,
      undefined,
      false,
    );

    await expect(
      checkpointer.getTuple({ configurable: { thread_id: 'thread-1' } }),
    ).resolves.toBeUndefined();
  });

  it('fails closed instead of using process memory when Redis is required', async () => {
    const checkpointer = new RedisCheckpointer(
      { isEnabled: () => false } as never,
      60,
      undefined,
      true,
    );

    await expect(
      checkpointer.getTuple({ configurable: { thread_id: 'thread-1' } }),
    ).rejects.toThrow('requires Redis');
  });
});
