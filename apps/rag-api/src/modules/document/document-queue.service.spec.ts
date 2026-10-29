import { Queue, QueueEvents, Worker } from 'bullmq';
import { DocumentQueueService } from './document-queue.service';
import type { ObsidianNoteIngestJob } from './document-queue.service';

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

  it('lists pending BullMQ jobs and reports disabled queues explicitly', async () => {
    const pendingJob = {
      data: job,
      timestamp: 1234,
      getState: jest.fn().mockResolvedValue('delayed'),
    };
    let documentQueue: Record<string, jest.Mock> | undefined;
    bullMqMocks.Queue.mockImplementation(() => {
      const queue = {
        getJobs: jest.fn().mockResolvedValue([pendingJob]),
        close: jest.fn().mockResolvedValue(undefined),
      };
      documentQueue ??= queue;
      return queue;
    });
    bullMqMocks.QueueEvents.mockImplementation(() => ({
      close: jest.fn().mockResolvedValue(undefined),
    }));
    bullMqMocks.Worker.mockImplementation(() => ({
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    }));
    const config = {
      get: jest.fn(
        (key: string) =>
          ({ nodeEnv: 'production', 'redis.url': 'redis://localhost:6379' })[
            key as 'nodeEnv' | 'redis.url'
          ],
      ),
    };
    const service = new DocumentQueueService(
      config as never,
      objectStorage as never,
    );

    await expect(service.listPending(10)).resolves.toEqual({
      enabled: true,
      tasks: [
        {
          taskId: job.taskId,
          filename: job.filename,
          status: 'delayed',
          createdAt: 1234,
        },
      ],
    });
    expect(documentQueue?.getJobs).toHaveBeenCalledWith(
      ['waiting', 'delayed', 'paused', 'waiting-children'],
      0,
      9,
    );

    const disabledService = new DocumentQueueService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, unknown> = {
            nodeEnv: 'development',
            'redis.url': undefined,
          };
          return values[key];
        }),
      } as never,
      objectStorage as never,
    );
    await expect(disabledService.listPending()).resolves.toEqual({
      enabled: false,
      tasks: [],
    });
  });

  it('cancels only pending jobs and schedules original-object cleanup', async () => {
    const queueInstances: Array<Record<string, jest.Mock>> = [];
    const pendingJob = {
      data: job,
      getState: jest.fn().mockResolvedValue('waiting'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    bullMqMocks.Queue.mockImplementation(() => {
      const queue = {
        getJob: jest.fn().mockResolvedValue(pendingJob),
        add: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
      };
      queueInstances.push(queue);
      return queue;
    });
    bullMqMocks.QueueEvents.mockImplementation(() => ({
      close: jest.fn().mockResolvedValue(undefined),
    }));
    bullMqMocks.Worker.mockImplementation(() => ({
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    }));
    const config = {
      get: jest.fn(
        (key: string) =>
          ({ nodeEnv: 'production', 'redis.url': 'redis://localhost:6379' })[
            key as 'nodeEnv' | 'redis.url'
          ],
      ),
    };
    const service = new DocumentQueueService(
      config as never,
      objectStorage as never,
    );

    await expect(service.cancelPending(job.taskId)).resolves.toEqual({
      taskId: job.taskId,
      cancelled: true,
      cleanupScheduled: true,
      cleanupCompleted: false,
    });
    expect(pendingJob.remove).toHaveBeenCalledTimes(1);
    expect(queueInstances[2].add).toHaveBeenCalledWith(
      job.taskId,
      { objectKey: job.objectKey },
      { jobId: job.taskId, delay: 0 },
    );

    pendingJob.getState.mockResolvedValue('active');
    await expect(service.cancelPending(job.taskId)).resolves.toEqual({
      taskId: job.taskId,
      cancelled: false,
      reason: '任务已处理中，无法中断。',
    });
    expect(pendingJob.remove).toHaveBeenCalledTimes(1);

    let state = 'waiting';
    const racingJob = {
      data: job,
      getState: jest.fn(() => Promise.resolve(state)),
      remove: jest.fn(async () => {
        state = 'active';
        throw new Error('job is locked by a worker');
      }),
    };
    queueInstances[0].getJob.mockResolvedValue(racingJob);
    await expect(service.cancelPending(job.taskId)).resolves.toEqual({
      taskId: job.taskId,
      cancelled: false,
      reason: '任务已处理中，无法中断。',
    });
    expect(queueInstances[2].add).toHaveBeenCalledTimes(1);
  });

  it('does not report queue cancellation success when Redis is disabled', async () => {
    const service = new DocumentQueueService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, unknown> = {
            nodeEnv: 'development',
            'redis.url': undefined,
          };
          return values[key];
        }),
      } as never,
      objectStorage as never,
    );

    await expect(service.cancelPending(job.taskId)).resolves.toEqual({
      taskId: job.taskId,
      cancelled: false,
      reason: 'Redis/BullMQ 不可用，无法取消排队任务。',
    });
  });

  it('falls back to deleting the source when cleanup queue scheduling fails', async () => {
    const queues: Array<Record<string, jest.Mock>> = [];
    const queuedJob = {
      data: job,
      getState: jest.fn().mockResolvedValue('waiting'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    bullMqMocks.Queue.mockImplementation(() => {
      const queue = {
        getJob: jest.fn().mockResolvedValue(queuedJob),
        add: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
      };
      queues.push(queue);
      return queue;
    });
    bullMqMocks.QueueEvents.mockImplementation(() => ({
      close: jest.fn().mockResolvedValue(undefined),
    }));
    bullMqMocks.Worker.mockImplementation(() => ({
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    }));
    const storage = { deleteObject: jest.fn().mockResolvedValue(undefined) };
    const service = new DocumentQueueService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, unknown> = {
            nodeEnv: 'production',
            'redis.url': 'redis://localhost:6379',
          };
          return values[key];
        }),
      } as never,
      storage as never,
    );
    queues[2].add.mockRejectedValue(new Error('redis unavailable'));

    await expect(service.cancelPending(job.taskId)).resolves.toEqual({
      taskId: job.taskId,
      cancelled: true,
      cleanupScheduled: false,
      cleanupCompleted: true,
    });
    expect(storage.deleteObject).toHaveBeenCalledWith(job.objectKey);
  });

  it('keeps the source through a retry and expires it after terminal failure', async () => {
    const workerHandlers: Record<
      string,
      Record<string, (...args: any[]) => void>
    > = {};
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
    bullMqMocks.Worker.mockImplementation((queueName: string) => ({
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        workerHandlers[queueName] ??= {};
        workerHandlers[queueName][event] = handler;
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

    workerHandlers['document-processing'].failed(
      { data: job, attemptsMade: 1, opts: { attempts: 3 } },
      new Error('temporary failure'),
    );
    expect(queueInstances[1].add).not.toHaveBeenCalled();

    workerHandlers['document-processing'].failed(
      { data: job, attemptsMade: 3, opts: { attempts: 3 } },
      new Error('terminal failure'),
    );
    expect(queueInstances[2].add).toHaveBeenCalledWith(
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

    workerHandlers['document-processing'].completed({ data: job });
    await new Promise((resolve) => setImmediate(resolve));
    expect(queueInstances[2].add).toHaveBeenLastCalledWith(
      job.taskId,
      { objectKey: job.objectKey },
      { jobId: job.taskId, delay: 0 },
    );
  });

  it('stores only document metadata in the optional note queue', async () => {
    const queueInstances: Array<Record<string, jest.Mock>> = [];
    const queuedJobs: ObsidianNoteIngestJob[] = [];
    const processors: Record<
      string,
      (job: { data: ObsidianNoteIngestJob }) => Promise<void>
    > = {};
    const objectStorage = {
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    bullMqMocks.Queue.mockImplementation(() => {
      const queue = {
        add: jest.fn((_name: string, data: ObsidianNoteIngestJob) => {
          queuedJobs.push(data);
          return Promise.resolve();
        }),
        getJob: jest.fn().mockResolvedValue(null),
        close: jest.fn().mockResolvedValue(undefined),
      };
      queueInstances.push(queue);
      return queue;
    });
    bullMqMocks.QueueEvents.mockImplementation(() => ({
      close: jest.fn().mockResolvedValue(undefined),
    }));
    bullMqMocks.Worker.mockImplementation(
      (
        queueName: string,
        processor: (job: { data: ObsidianNoteIngestJob }) => Promise<void>,
      ) => {
        processors[queueName] = processor;
        return {
          on: jest.fn(),
          close: jest.fn().mockResolvedValue(undefined),
        };
      },
    );

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
    const noteProcessor = jest.fn().mockResolvedValue(undefined);
    service.registerObsidianNoteProcessor(noteProcessor);
    const result = await service.enqueueObsidianNote({
      docId: 'doc-1',
      userId: 'user-1',
      title: 'Guide',
      contentHash: 'a'.repeat(64),
      sourceType: 'document',
      filename: 'guide.md',
    });

    expect(result).toEqual({ status: 'queued', taskId: 'obsidian-doc-1' });
    expect(queueInstances[1].add).toHaveBeenCalledWith(
      'obsidian-doc-1',
      expect.objectContaining({
        docId: 'doc-1',
        userId: 'user-1',
        title: 'Guide',
        taskId: 'obsidian-doc-1',
      }),
      { jobId: 'obsidian-doc-1' },
    );
    const queuedJob = queuedJobs[0];
    expect(queuedJob).not.toHaveProperty('content');

    await processors['obsidian-note-ingest']({ data: queuedJob });
    expect(noteProcessor).toHaveBeenCalledWith(queuedJob);
  });

  it('reports an unavailable Redis queue as skipped for optional note work', async () => {
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
      { deleteObject: jest.fn() } as never,
    );

    await expect(
      service.enqueueObsidianNote({
        docId: 'doc-1',
        userId: 'user-1',
        title: 'Guide',
        contentHash: 'a'.repeat(64),
        sourceType: 'document',
      }),
    ).resolves.toEqual({
      status: 'skipped',
      reason: 'Redis/BullMQ is unavailable',
    });
  });

  it('returns skipped when Redis rejects the optional note task', async () => {
    const queueInstances: Array<Record<string, jest.Mock>> = [];
    bullMqMocks.Queue.mockImplementation(() => {
      const queue = {
        add: jest.fn().mockResolvedValue(undefined),
        getJob: jest.fn().mockResolvedValue(null),
        close: jest.fn().mockResolvedValue(undefined),
      };
      queueInstances.push(queue);
      return queue;
    });
    bullMqMocks.QueueEvents.mockImplementation(() => ({
      close: jest.fn().mockResolvedValue(undefined),
    }));
    bullMqMocks.Worker.mockImplementation(() => ({
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    }));
    const config = {
      get: jest.fn(
        (key: string) =>
          (
            ({
              nodeEnv: 'development',
              'redis.url': 'redis://localhost:6379',
            }) as Record<string, unknown>
          )[key],
      ),
    };
    const service = new DocumentQueueService(
      config as never,
      { deleteObject: jest.fn() } as never,
    );
    queueInstances[1].add.mockRejectedValue(new Error('Redis unavailable'));

    await expect(
      service.enqueueObsidianNote({
        docId: 'doc-1',
        userId: 'user-1',
        title: 'Guide',
        contentHash: 'a'.repeat(64),
        sourceType: 'document',
      }),
    ).resolves.toEqual({
      status: 'skipped',
      reason: 'Redis unavailable',
    });
  });

  it('bounds time spent waiting for the optional queue', async () => {
    const queueInstances: Array<Record<string, jest.Mock>> = [];
    bullMqMocks.Queue.mockImplementation(() => {
      const queue = {
        add: jest.fn().mockResolvedValue(undefined),
        getJob: jest.fn().mockResolvedValue(null),
        close: jest.fn().mockResolvedValue(undefined),
      };
      queueInstances.push(queue);
      return queue;
    });
    bullMqMocks.QueueEvents.mockImplementation(() => ({
      close: jest.fn().mockResolvedValue(undefined),
    }));
    bullMqMocks.Worker.mockImplementation(() => ({
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    }));
    const config = {
      get: jest.fn(
        (key: string) =>
          (
            ({
              nodeEnv: 'development',
              'redis.url': 'redis://localhost:6379',
            }) as Record<string, unknown>
          )[key],
      ),
    };
    const service = new DocumentQueueService(
      config as never,
      { deleteObject: jest.fn() } as never,
    );
    queueInstances[1].add.mockReturnValue(new Promise(() => undefined));
    const previousTimeout = process.env.OBSIDIAN_NOTE_ENQUEUE_TIMEOUT_MS;
    process.env.OBSIDIAN_NOTE_ENQUEUE_TIMEOUT_MS = '100';

    try {
      await expect(
        service.enqueueObsidianNote({
          docId: 'doc-1',
          userId: 'user-1',
          title: 'Guide',
          contentHash: 'a'.repeat(64),
          sourceType: 'document',
        }),
      ).resolves.toMatchObject({
        status: 'skipped',
        reason: 'Obsidian note queue enqueue timed out',
      });
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.OBSIDIAN_NOTE_ENQUEUE_TIMEOUT_MS;
      } else {
        process.env.OBSIDIAN_NOTE_ENQUEUE_TIMEOUT_MS = previousTimeout;
      }
    }
  });
});
