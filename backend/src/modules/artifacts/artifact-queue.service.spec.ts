import { ConfigService } from '@nestjs/config';
import { ArtifactQueueService } from './artifact-queue.service';

describe('ArtifactQueueService', () => {
  const config = (values: Record<string, unknown>) =>
    ({ get: (key: string) => values[key] } as unknown as ConfigService);

  it('fails closed in production without Redis', async () => {
    const queue = new ArtifactQueueService(
      config({ nodeEnv: 'production', 'redis.url': undefined }),
    );

    await expect(queue.enqueue('artifact-1')).rejects.toThrow(
      '生产 Artifact 生成要求使用 Redis',
    );
    await queue.onModuleDestroy();
  });

  it('keeps local in-process fallback in development', async () => {
    const processor = jest.fn().mockResolvedValue(undefined);
    const queue = new ArtifactQueueService(
      config({ nodeEnv: 'development', 'redis.url': undefined }),
    );
    queue.registerProcessor(processor);
    await expect(queue.enqueue('artifact-1')).resolves.toBeUndefined();
    await queue.onModuleDestroy();
  });
});
