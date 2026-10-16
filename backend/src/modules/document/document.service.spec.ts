import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentService } from './document.service';

function createService() {
  const metaUpdate = jest.fn().mockResolvedValue({ affected: 1 });
  const chunkUpdate = jest.fn().mockResolvedValue({ affected: 1 });
  const manager = {
    getRepository: jest.fn(
      (entity: typeof DocumentMetaEntity | typeof DocumentChunkEntity) =>
        entity === DocumentMetaEntity
          ? { update: metaUpdate }
          : { update: chunkUpdate },
    ),
  };
  const service = Object.create(DocumentService.prototype) as DocumentService;
  const mocks = {
    metaUpdate,
    chunkUpdate,
    manager,
    retrievalDescriptionService: {
      rebuild: jest.fn().mockResolvedValue(undefined),
      deleteForDocument: jest.fn().mockResolvedValue(undefined),
    },
    docMetaRepo: {
      findOne: jest.fn(),
      find: jest.fn(),
      manager: {
        transaction: jest.fn((callback: (value: typeof manager) => unknown) =>
          callback(manager),
        ),
      },
    },
    docChunkRepo: { delete: jest.fn().mockResolvedValue(undefined) },
    factConflictRepo: { delete: jest.fn().mockResolvedValue(undefined) },
    resourceRepo: { update: jest.fn().mockResolvedValue(undefined) },
    taskRepo: {
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    },
    documentQueueService: {
      listPending: jest.fn(),
      cancelPending: jest.fn(),
    },
    vectorStoreProvider: {
      deleteByDocId: jest.fn().mockResolvedValue(undefined),
    },
    karpathyRagService: {
      updateDocumentLifecycle: jest.fn(),
      removeDocChunks: jest.fn(),
    },
    elasticsearchProvider: {
      updateDocumentLifecycle: jest.fn().mockResolvedValue(undefined),
      deleteByDocId: jest.fn().mockResolvedValue(undefined),
    },
    imageIndexService: { deleteByDoc: jest.fn().mockResolvedValue(undefined) },
    graphService: { removeSource: jest.fn().mockResolvedValue(undefined) },
    domainEvents: { emitInTransaction: jest.fn() },
    logger: { log: jest.fn(), warn: jest.fn() },
  };
  Object.assign(service, mocks);
  return { service, mocks };
}

describe('DocumentService retrieval descriptions', () => {
  it('rebuilds descriptions after the lifecycle update is committed', async () => {
    const { service, mocks } = createService();
    mocks.docMetaRepo.findOne.mockResolvedValue({
      docId: 'doc-1',
      tenantId: 'tenant-1',
    });
    const callOrder: string[] = [];
    mocks.docMetaRepo.manager.transaction.mockImplementationOnce(
      async (callback: (manager: typeof mocks.manager) => Promise<void>) => {
        await callback(mocks.manager);
        callOrder.push('transaction');
      },
    );
    mocks.retrievalDescriptionService.rebuild.mockImplementationOnce(
      async () => {
        callOrder.push('rebuild');
      },
    );

    await expect(
      service.updateLifecycle('doc-1', 'user-1', 'effective'),
    ).resolves.toBe(true);

    expect(callOrder).toEqual(['transaction', 'rebuild']);
    expect(mocks.retrievalDescriptionService.rebuild).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      docId: 'doc-1',
    });
  });

  it('rebuilds descriptions for every document changed during version activation', async () => {
    const { service, mocks } = createService();
    mocks.docMetaRepo.find.mockResolvedValue([
      { docId: 'new-doc', tenantId: 'tenant-1', chunkCount: 1 },
      { docId: 'old-doc', tenantId: 'tenant-2', chunkCount: 3 },
    ]);

    await expect(
      service.activateVersion('new-doc', 'user-1', ['new-doc', 'old-doc']),
    ).resolves.toBe(true);

    expect(mocks.retrievalDescriptionService.rebuild).toHaveBeenNthCalledWith(
      1,
      { tenantId: 'tenant-1', docId: 'new-doc' },
    );
    expect(mocks.retrievalDescriptionService.rebuild).toHaveBeenNthCalledWith(
      2,
      { tenantId: 'tenant-2', docId: 'old-doc' },
    );
  });

  it('does not delete the source document when description cleanup fails', async () => {
    const { service, mocks } = createService();
    mocks.docMetaRepo.findOne.mockResolvedValue({
      docId: 'doc-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      filename: 'guide.md',
    });
    mocks.retrievalDescriptionService.deleteForDocument.mockRejectedValue(
      new Error('vector delete failed'),
    );

    await expect(service.delete('doc-1', 'user-1')).rejects.toThrow(
      'vector delete failed',
    );

    expect(
      mocks.retrievalDescriptionService.deleteForDocument,
    ).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      docId: 'doc-1',
    });
    expect(mocks.vectorStoreProvider.deleteByDocId).not.toHaveBeenCalled();
    expect(mocks.docChunkRepo.delete).not.toHaveBeenCalled();
  });

  it('lists only queued database tasks that still exist in BullMQ', async () => {
    const { service, mocks } = createService();
    mocks.documentQueueService.listPending.mockResolvedValue({
      enabled: true,
      tasks: [
        {
          taskId: 'queued-1',
          filename: 'queued.pdf',
          status: 'waiting',
          createdAt: 10,
        },
        {
          taskId: 'active-1',
          filename: 'active.pdf',
          status: 'waiting',
          createdAt: 20,
        },
      ],
    });
    mocks.taskRepo.find.mockResolvedValue([
      {
        id: 'queued-1',
        filename: 'queued.pdf',
        status: 'queued',
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      { id: 'active-1', filename: 'active.pdf', status: 'processing' },
    ]);

    await expect(service.getPendingTasks(10)).resolves.toEqual({
      enabled: true,
      tasks: [
        {
          id: 'queued-1',
          filename: 'queued.pdf',
          status: 'queued',
          queueStatus: 'waiting',
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('marks a task cancelled only after BullMQ confirms removal', async () => {
    const { service, mocks } = createService();
    mocks.taskRepo.findOne.mockResolvedValue({
      id: 'task-1',
      status: 'queued',
    });
    mocks.documentQueueService.cancelPending.mockResolvedValue({
      taskId: 'task-1',
      cancelled: true,
      cleanupScheduled: true,
    });

    await expect(service.cancelQueuedTask('task-1')).resolves.toEqual({
      taskId: 'task-1',
      cancelled: true,
      cleanupScheduled: true,
    });
    expect(mocks.taskRepo.update).toHaveBeenCalledWith(
      { id: 'task-1' },
      expect.objectContaining({ status: 'cancelled', stage: 'cancelled' }),
    );
  });

  it('refuses to interrupt processing tasks without touching BullMQ', async () => {
    const { service, mocks } = createService();
    mocks.taskRepo.findOne.mockResolvedValue({
      id: 'task-1',
      status: 'processing',
    });

    await expect(service.cancelQueuedTask('task-1')).resolves.toEqual({
      taskId: 'task-1',
      cancelled: false,
      reason: '任务已处理中，无法中断。',
    });
    expect(mocks.documentQueueService.cancelPending).not.toHaveBeenCalled();
    expect(mocks.taskRepo.update).not.toHaveBeenCalled();
  });

  it('keeps the task queued when Redis is unavailable', async () => {
    const { service, mocks } = createService();
    mocks.taskRepo.findOne.mockResolvedValue({
      id: 'task-1',
      status: 'queued',
    });
    mocks.documentQueueService.cancelPending.mockResolvedValue({
      taskId: 'task-1',
      cancelled: false,
      reason: 'Redis/BullMQ 不可用，无法取消排队任务。',
    });

    await expect(service.cancelQueuedTask('task-1')).resolves.toEqual({
      taskId: 'task-1',
      cancelled: false,
      reason: 'Redis/BullMQ 不可用，无法取消排队任务。',
    });
    expect(mocks.taskRepo.update).not.toHaveBeenCalled();
  });
});
