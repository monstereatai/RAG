import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentTaskService } from './document-task.service';
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
      delete: jest.fn().mockResolvedValue(undefined),
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
    documentIndexCoordinator: {
      getMilvusDeleteCompensationStatus: jest.fn().mockResolvedValue({
        pendingDurable: false,
        pendingMilvusDeletes: [],
        pendingMilvusDeleteCount: 0,
        note: '',
      }),
      removeVectorIndex: jest.fn().mockResolvedValue(undefined),
      removeSearchIndexes: jest.fn().mockResolvedValue(undefined),
      removeBm25Chunks: jest.fn(),
      updateElasticsearchDocumentLifecycle: jest
        .fn()
        .mockResolvedValue(undefined),
      updateBm25DocumentLifecycle: jest.fn(),
      updateDocumentLifecycle: jest.fn().mockResolvedValue(undefined),
    },
    imageIndexService: { deleteByDoc: jest.fn().mockResolvedValue(undefined) },
    graphService: { removeSource: jest.fn().mockResolvedValue(undefined) },
    domainEvents: { emitInTransaction: jest.fn() },
    logger: { log: jest.fn(), warn: jest.fn() },
  };
  const documentTaskService = new DocumentTaskService(
    mocks.taskRepo as never,
    mocks.documentQueueService as never,
  );
  Object.assign(service, mocks, {
    documentTaskService,
    cancelledGraphIndexes: new Set<string>(),
    pendingGraphIndexes: new Map<string, Promise<void>>(),
  });
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
    mocks.retrievalDescriptionService.rebuild.mockImplementationOnce(() => {
      callOrder.push('rebuild');
      return Promise.resolve();
    });

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
    expect(
      mocks.documentIndexCoordinator.updateElasticsearchDocumentLifecycle,
    ).toHaveBeenNthCalledWith(1, 'old-doc', 'deprecated', 'user-1');
    expect(
      mocks.documentIndexCoordinator.updateElasticsearchDocumentLifecycle,
    ).toHaveBeenNthCalledWith(2, 'new-doc', 'effective', 'user-1');
    expect(
      mocks.documentIndexCoordinator.updateBm25DocumentLifecycle,
    ).toHaveBeenNthCalledWith(1, 'old-doc', 'deprecated', 'user-1');
    expect(
      mocks.documentIndexCoordinator.updateBm25DocumentLifecycle,
    ).toHaveBeenNthCalledWith(2, 'new-doc', 'effective', 'user-1');
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
    expect(
      mocks.documentIndexCoordinator.removeVectorIndex,
    ).toHaveBeenCalledWith('doc-1');
    expect(
      mocks.documentIndexCoordinator.removeSearchIndexes,
    ).not.toHaveBeenCalled();
    expect(mocks.docChunkRepo.delete).not.toHaveBeenCalled();
  });

  it('does not delete PostgreSQL records when Milvus compensation is not durable', async () => {
    const { service, mocks } = createService();
    mocks.docMetaRepo.findOne.mockResolvedValue({
      docId: 'doc-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      filename: 'guide.md',
    });
    mocks.documentIndexCoordinator.removeVectorIndex.mockRejectedValue(
      new Error(
        'Milvus 删除失败，补偿任务未能可靠保存；文档保留，请稍后重试。',
      ),
    );

    await expect(service.delete('doc-1', 'user-1')).rejects.toThrow(
      'Milvus 删除失败，补偿任务未能可靠保存；文档保留，请稍后重试。',
    );

    expect(
      mocks.retrievalDescriptionService.deleteForDocument,
    ).not.toHaveBeenCalled();
    expect(mocks.factConflictRepo.delete).not.toHaveBeenCalled();
    expect(mocks.docChunkRepo.delete).not.toHaveBeenCalled();
    expect(mocks.docMetaRepo.delete).not.toHaveBeenCalled();
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
