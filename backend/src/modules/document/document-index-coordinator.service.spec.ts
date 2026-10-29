import { DocumentIndexCoordinator } from './document-index-coordinator.service';

function createCoordinator(options?: { redisEnabled?: boolean }) {
  const embeddingProvider = { embedDocuments: jest.fn() };
  const vectorStoreProvider = {
    insert: jest.fn().mockResolvedValue(undefined),
    deleteByDocId: jest.fn().mockResolvedValue(undefined),
  };
  const ragService = {
    indexChunks: jest.fn(),
    updateChunkMetadataByIds: jest.fn(),
    updateDocumentLifecycle: jest.fn(),
    removeDocChunks: jest.fn(),
  };
  const elasticsearchProvider = {
    indexChunks: jest.fn().mockResolvedValue(undefined),
    indexDocument: jest.fn().mockResolvedValue(undefined),
    updateChunkMetadataByIds: jest.fn().mockResolvedValue(undefined),
    updateDocumentLifecycle: jest.fn().mockResolvedValue(undefined),
    deleteByDocId: jest.fn().mockResolvedValue(undefined),
    isEnabled: jest.fn().mockReturnValue(true),
  };
  const redisProvider = {
    isEnabled: jest.fn().mockReturnValue(options?.redisEnabled ?? false),
    setRequired: jest.fn().mockResolvedValue(true),
  };
  const coordinator = new DocumentIndexCoordinator(
    embeddingProvider as never,
    vectorStoreProvider as never,
    ragService as never,
    elasticsearchProvider as never,
    redisProvider as never,
  );
  return {
    coordinator,
    embeddingProvider,
    vectorStoreProvider,
    ragService,
    elasticsearchProvider,
    redisProvider,
  };
}

describe('DocumentIndexCoordinator', () => {
  it('waits for all primary index groups after a synchronous Milvus failure', async () => {
    const {
      coordinator,
      vectorStoreProvider,
      ragService,
      elasticsearchProvider,
    } = createCoordinator();
    vectorStoreProvider.insert.mockImplementation(() => {
      throw new Error('milvus unavailable');
    });
    let resolveDocumentIndex!: () => void;
    elasticsearchProvider.indexDocument.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDocumentIndex = resolve;
        }),
    );

    let settled = false;
    const writePromise = coordinator
      .writeDocumentIndexes({
        records: [
          {
            id: 'chunk-1',
            content: 'content',
            docId: 'doc-1',
            chunkIndex: 0,
            userId: 'user-1',
            tenantId: 'tenant-1',
            contentHash: 'hash',
            indexGeneration: 'generation-1',
          },
        ],
        chunks: [{ id: 'chunk-1', content: 'content' }] as never,
        userId: 'user-1',
        vectors: [[0.1]],
        document: { docId: 'doc-1' } as never,
      })
      .finally(() => {
        settled = true;
      });

    expect(ragService.indexChunks).toHaveBeenCalledTimes(1);
    expect(elasticsearchProvider.indexChunks).toHaveBeenCalledTimes(1);
    expect(elasticsearchProvider.indexDocument).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveDocumentIndex();
    await expect(writePromise).rejects.toThrow('milvus unavailable');
    expect(settled).toBe(true);
  });

  it('persists a failed Milvus cleanup for retry without blocking other cleanup', async () => {
    const {
      coordinator,
      vectorStoreProvider,
      ragService,
      elasticsearchProvider,
      redisProvider,
    } = createCoordinator({ redisEnabled: true });
    vectorStoreProvider.deleteByDocId.mockRejectedValue(
      new Error('milvus unavailable'),
    );
    elasticsearchProvider.deleteByDocId.mockRejectedValue(
      new Error('elasticsearch unavailable'),
    );

    try {
      await expect(
        coordinator.cleanupFailedExternalIndexes('doc-1', 'user-1'),
      ).resolves.toBeUndefined();

      expect(redisProvider.setRequired).toHaveBeenCalledWith(
        'rag:index:milvus:delete:pending:v2:ZG9jLTE',
        JSON.stringify({ docId: 'doc-1', attempts: 1 }),
      );
      expect(elasticsearchProvider.deleteByDocId).toHaveBeenCalledWith(
        'doc-1',
        'user-1',
      );
      expect(ragService.removeDocChunks).toHaveBeenCalledWith(
        'doc-1',
        'user-1',
      );
    } finally {
      coordinator.onModuleDestroy();
    }
  });

  it('refuses vector deletion when Redis cannot persist its compensation', async () => {
    const { coordinator, vectorStoreProvider, redisProvider } =
      createCoordinator({ redisEnabled: true });
    vectorStoreProvider.deleteByDocId.mockRejectedValue(
      new Error('milvus unavailable'),
    );
    redisProvider.setRequired.mockResolvedValue(false);

    try {
      await expect(coordinator.removeVectorIndex('doc-1')).rejects.toThrow(
        'Milvus 删除失败，补偿任务未能可靠保存；文档保留，请稍后重试。',
      );
      expect(redisProvider.setRequired).toHaveBeenCalledTimes(1);
    } finally {
      coordinator.onModuleDestroy();
    }
  });

  it('projects lifecycle to both indexes in order with the original user scope', async () => {
    const { coordinator, ragService, elasticsearchProvider } =
      createCoordinator();
    const calls: string[] = [];
    elasticsearchProvider.updateDocumentLifecycle.mockImplementation(() => {
      calls.push('elasticsearch');
      return Promise.resolve();
    });
    ragService.updateDocumentLifecycle.mockImplementation(() => {
      calls.push('bm25');
    });

    await coordinator.updateDocumentLifecycle('doc-1', 'effective', 'user-1');

    expect(calls).toEqual(['elasticsearch', 'bm25']);
    expect(elasticsearchProvider.updateDocumentLifecycle).toHaveBeenCalledWith(
      'doc-1',
      'effective',
      'user-1',
    );
    expect(ragService.updateDocumentLifecycle).toHaveBeenCalledWith(
      'doc-1',
      'effective',
      'user-1',
    );
  });

  it('still refreshes the document index when an incremental update has no changed chunks', async () => {
    const {
      coordinator,
      vectorStoreProvider,
      ragService,
      elasticsearchProvider,
    } = createCoordinator();

    await coordinator.writeIncrementalIndexes({
      records: [],
      chunks: [],
      userId: 'user-1',
      vectors: [],
      document: { docId: 'doc-1' } as never,
    });

    expect(vectorStoreProvider.insert).not.toHaveBeenCalled();
    expect(ragService.indexChunks).not.toHaveBeenCalled();
    expect(elasticsearchProvider.indexChunks).not.toHaveBeenCalled();
    expect(elasticsearchProvider.indexDocument).toHaveBeenCalledTimes(1);
  });
});
