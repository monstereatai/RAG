import { DocumentQueueService } from './document-queue.service';

describe('DocumentQueueService', () => {
  const job = {
    taskId: 'task-1',
    userId: 'user-1',
    filename: 'note.md',
    originalBufferBase64: Buffer.from('content').toString('base64'),
  };

  it('rejects the process-local fallback when production requires Redis', async () => {
    const config = {
      get: jest.fn((key: string) =>
        ({ nodeEnv: 'production', 'redis.url': undefined } as Record<
          string,
          unknown
        >)[key],
      ),
    };
    const service = new DocumentQueueService(config as never);

    expect(service.enabled).toBe(false);
    expect(service.required).toBe(true);
    await expect(service.enqueue(job)).rejects.toThrow('要求使用 Redis');
  });

  it('keeps the synchronous fallback available for local development', async () => {
    const config = {
      get: jest.fn((key: string) =>
        ({ nodeEnv: 'development', 'redis.url': undefined } as Record<
          string,
          unknown
        >)[key],
      ),
    };
    const service = new DocumentQueueService(config as never);

    expect(service.required).toBe(false);
    await expect(service.enqueue(job)).resolves.toBe(job.taskId);
  });
});
