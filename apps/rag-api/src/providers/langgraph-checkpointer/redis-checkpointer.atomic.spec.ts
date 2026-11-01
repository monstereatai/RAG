import { RedisCheckpointer } from './redis-checkpointer';
import type { Checkpoint } from '@langchain/langgraph-checkpoint';

describe('RedisCheckpointer durable atomic saves', () => {
  const checkpoint = {
    v: 1, id: 'cp-1', ts: '2026-11-01T00:00:00.000Z',
    channel_values: {}, channel_versions: {}, versions_seen: {},
  } as unknown as Checkpoint;

  it('publishes checkpoint payload + metadata + pointer in a single provider operation', async () => {
    const commitCheckpointRequired = jest.fn().mockResolvedValue(undefined);
    const redis = { isEnabled: () => true, commitCheckpointRequired } as never;
    const saver = new RedisCheckpointer(redis, 0, undefined, true);
    const result = await saver.put({ configurable: { thread_id: 'thread-1' } }, checkpoint, { source:'input', step:1 });
    expect(result.configurable?.checkpoint_id).toBe('cp-1');
    expect(commitCheckpointRequired).toHaveBeenCalledTimes(1);
    expect(commitCheckpointRequired).toHaveBeenCalledWith(expect.objectContaining({
      threadId:'thread-1', checkpointId:'cp-1', ttlSeconds:0,
      timestampMs:Date.parse(checkpoint.ts),
    }));
  });

  it('fails closed on an atomic commit failure', async () => {
    const commitCheckpointRequired = jest.fn().mockRejectedValue(new Error('redis IO lost'));
    const saver = new RedisCheckpointer({ isEnabled:()=>true, commitCheckpointRequired } as never, 60, undefined, true);
    await expect(saver.put({configurable:{thread_id:'t'}},checkpoint,{source:'input',step:1})).rejects.toThrow('redis IO lost');
  });

  it('writes pending tool state through one atomic provider call', async () => {
    const commitCheckpointWritesRequired = jest.fn().mockResolvedValue(undefined);
    const saver = new RedisCheckpointer({isEnabled:()=>true,commitCheckpointWritesRequired} as never, 0, undefined, true);
    await saver.putWrites({configurable:{thread_id:'t',checkpoint_id:'c'}},[['task-input','v1']], 'task-1');
    expect(commitCheckpointWritesRequired).toHaveBeenCalledTimes(1);
    expect(commitCheckpointWritesRequired).toHaveBeenCalledWith(expect.objectContaining({threadId:'t',checkpointId:'c',taskId:'task-1',ttlSeconds:0}));
  });
});
