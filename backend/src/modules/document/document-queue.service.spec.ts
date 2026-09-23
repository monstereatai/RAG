import { Queue, QueueEvents, Worker } from 'bullmq';
import { DocumentQueueService } from './document-queue.service';

const bullMqMocks = {
  Queue: Queue as unknown as jest.Mock,
  QueueEvents: QueueEvents as unknown as jest.Mock,
  Worker: Worker as unknown as jest.Mock,
};

jest.mock('bullmq', () => ({
  Queue: jest.fn(),
  QueueEvents: jest.fn(),
  Worker: jest.fn(),
}));

describe('DocumentQueueService', () => {
  const job = {
    taskId: 'task-1',
    userId: 'user-1',
    filename: 'note.md',
    objectKey: 'documents/user-1/queue/task-1/note.md',
  };

  const objectStorage = {
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };

  it('rejects the process-local fallback when production requires Redis', async () => {
    const config = {
      get: jest.fn(
        (key: string) =>
          (
            ({ nodeEnv: 'production', 'redis.url': undefined }) as Record<
              string,
              unknown
            >
          )[key],
      ),
    };
    const service = new DocumentQueueService(
      config as never,
      objectStorage as never,
    );

    expect(service.enabled).toBe(false);
    expect(service.required).toBe(true);
    await expect(service.enqueue(job)).rejects.toThrow('要求使用 Redis');
  });

  it('keeps the synchronous fallback available for local development', async () => {
    const config = {
      get: jest.fn(
        (key: string) =>
          (
            ({ nodeEnv: 'development', 'redis.url': undefined }) as Record<
              string,
              unknown
            >
          )[key],
      ),
    };
    const service = new DocumentQueueService(
      config as never,
      objectStorage as never,
    );

    expect(service.required).toBe(false);
    await expect(service.enqueue(job)).resolves.toBe(job.taskId);
  });

  it('keeps the source through a retry and expires it after terminal failure', async () => {
    const workerHandlers: Record<string, (...args: any[]) => void> = {};
    const queueInstances: Array<Record<string, jest.Mock>> = [];
    const cleanupJob = { remove: jest.fn().mockResolvedValue(undefined) };

    bullMqMocks.Queue.mockImplementation(() => {
      const queue = {
        add: jest.fn().mockResolvedValue(undefined),
        getJob: jest.fn().mockResolvedValue(cleanupJob),
        close: jest.fn().mockResolvedValue(undefined),
      };
      queueInstances.push(queue);
      return queue;
    });
    bullMqMocks.QueueEvents.mockImplementation(() => ({
      close: jest.fn().mockResolvedValue(undefined),
    }));
    bullMqMocks.Worker.mockImplementation(() => ({
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        workerHandlers[event] = handler;
      }),
      close: jest.fn().mockResolvedValue(undefined),
    }));

    const config = {
      get: jest.fn(
        (key: string) =>
          (
            ({
              nodeEnv: 'production',
              'redis.url': 'redis://localhost:6379',
            }) as Record<string, unknown>
          )[key],
      ),
    };
    const service = new DocumentQueueService(
      config as never,
      objectStorage as never,
    );
    service.registerProcessor(jest.fn().mockResolvedValue(undefined));

    workerHandlers.failed(
      { data: job, attemptsMade: 1, opts: { attempts: 3 } },
      new Error('temporary failure'),
    );
    expect(queueInstances[1].add).not.toHaveBeenCalled();

    workerHandlers.failed(
      { data: job, attemptsMade: 3, opts: { attempts: 3 } },
      new Error('terminal failure'),
    );
    expect(queueInstances[1].add).toHaveBeenCalledWith(
      job.taskId,
      { objectKey: job.objectKey },
      expect.objectContaining({
        jobId: job.taskId,
        delay: 24 * 60 * 60 * 1000,
      }),
    );

    const failedJob = {
      data: job,
      getState: jest.fn().mockResolvedValue('failed'),
      retry: jest.fn().mockResolvedValue(undefined),
    };
    queueInstances[0].getJob.mockResolvedValue(failedJob);
    await expect(service.retryFailed(job.taskId)).resolves.toEqual({
      taskId: job.taskId,
      retried: true,
    });
    expect(cleanupJob.remove).toHaveBeenCalled();
    expect(failedJob.retry).toHaveBeenCalled();

    workerHandlers.completed({ data: job });
    await new Promise((resolve) => setImmediate(resolve));
    expect(queueInstances[1].add).toHaveBeenLastCalledWith(
      job.taskId,
      { objectKey: job.objectKey },
      { jobId: job.taskId, delay: 0 },
    );
  });
});
