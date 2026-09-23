import { RagAdminService } from './rag-admin.service';

describe('RagAdminService index reconciliation', () => {
  function createService(overrides: Record<string, unknown> = {}) {
    const service = Object.create(RagAdminService.prototype) as Record<
      string,
      unknown
    >;
    Object.assign(service, {
      docMetaRepo: {
        find: jest.fn().mockResolvedValue([
          {
            docId: 'doc-1',
            filename: 'guide.md',
            userId: 'user-1',
            chunkCount: 2,
            graphIndexStatus: 'skipped',
            lifecycleStatus: 'draft',
            reviewStatus: 'draft',
            expiredAt: null,
          },
        ]),
      },
      chunkRepo: {
        find: jest
          .fn()
          .mockResolvedValue([{ docId: 'doc-1' }, { docId: 'doc-1' }]),
      },
      karpathyRagService: {
        getIndexedChunkCount: jest.fn().mockReturnValue(2),
      },
      elasticsearchProvider: {
        getIndexCountsByDocId: jest.fn().mockResolvedValue({
          available: true,
          chunkCount: 2,
          documentCount: 1,
        }),
      },
      vectorStoreProvider: {
        getRuntimeStatus: jest.fn().mockReturnValue({ available: true }),
        countByDocId: jest.fn().mockResolvedValue(2),
      },
      graphService: {
        isEnabled: jest.fn().mockReturnValue(false),
      },
      ...overrides,
    });
    return service as RagAdminService;
  }

  it('reports all searchable indexes consistent with PostgreSQL chunks', async () => {
    const service = createService();

    const result = await service.auditDocumentIndexes(10);

    expect(result.issueCount).toBe(0);
    expect(result.checks[0]).toEqual(
      expect.objectContaining({
        docId: 'doc-1',
        chunkCount: 2,
        reasons: [],
        checks: expect.objectContaining({
          postgres: expect.objectContaining({ status: 'ok', actual: 2 }),
          bm25: expect.objectContaining({ status: 'ok', actual: 2 }),
          elasticsearch: expect.objectContaining({ status: 'ok', actual: 2 }),
          milvus: expect.objectContaining({ status: 'ok', actual: 2 }),
          graph: expect.objectContaining({ status: 'skipped' }),
        }),
      }),
    );
  });

  it('distinguishes an index mismatch from an unavailable vector store', async () => {
    const service = createService({
      elasticsearchProvider: {
        getIndexCountsByDocId: jest.fn().mockResolvedValue({
          available: true,
          chunkCount: 1,
          documentCount: 1,
        }),
      },
      vectorStoreProvider: {
        getRuntimeStatus: jest.fn().mockReturnValue({ available: false }),
        countByDocId: jest.fn(),
      },
    });

    const result = await service.auditDocumentIndexes(10);

    expect(result.issueCount).toBe(1);
    expect(result.issues[0].reasons).toEqual(
      expect.arrayContaining([
        'elasticsearch_index_count_mismatch',
        'milvus_unavailable',
      ]),
    );
    expect(result.issues[0].checks.milvus).toEqual(
      expect.objectContaining({ status: 'unavailable' }),
    );
  });

  it('detects stale BM25 and Elasticsearch index generations', async () => {
    const service = createService({
      chunkRepo: {
        find: jest.fn().mockResolvedValue([
          {
            docId: 'doc-1',
            contentHash: 'chunk-hash',
            indexGeneration: 'generation-v2',
          },
        ]),
      },
      karpathyRagService: {
        getIndexedChunkCount: jest.fn().mockReturnValue(1),
        getIndexedChunkHashes: jest.fn().mockReturnValue({
          hashes: ['chunk-hash'],
          generations: ['generation-v1'],
          complete: true,
        }),
      },
      elasticsearchProvider: {
        getIndexCountsByDocId: jest.fn().mockResolvedValue({
          available: true,
          chunkCount: 1,
          documentCount: 1,
          contentHashes: ['chunk-hash'],
          indexGenerations: ['generation-v1'],
        }),
      },
      vectorStoreProvider: {
        getRuntimeStatus: jest.fn().mockReturnValue({ available: true }),
        countByDocId: jest.fn().mockResolvedValue(1),
      },
    });

    const result = await service.auditDocumentIndexes(10);

    expect(result.issues[0].reasons).toEqual(
      expect.arrayContaining([
        'bm25_generation_mismatch',
        'elasticsearch_generation_mismatch',
      ]),
    );
  });

  it('queues repair jobs instead of rebuilding every document in the request', async () => {
    const enqueue = jest.fn().mockResolvedValue(true);
    const service = createService({
      elasticsearchProvider: {
        getIndexCountsByDocId: jest.fn().mockResolvedValue({
          available: true,
          chunkCount: 1,
          documentCount: 1,
        }),
      },
      indexRepairQueue: {
        isEnabled: jest.fn().mockReturnValue(true),
        isRequired: jest.fn().mockReturnValue(true),
        enqueue,
        getStatus: jest.fn().mockResolvedValue({
          enabled: true,
          waiting: 1,
          active: 0,
          completed: 0,
          failed: 0,
        }),
      },
    });

    const result = await service.repairDocumentIndexes({ limit: 10 });

    expect(result.queued).toBe(true);
    expect(result.requested).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ docId: 'doc-1', requestedBy: 'rag-admin' }),
    );
  });

  it('rebuilds derived indexes from PostgreSQL chunks without deleting document or ACL data', async () => {
    const document = {
      docId: 'doc-safe',
      userId: 'user-1',
      tenantId: 'tenant-1',
      filename: 'guide.md',
      title: 'Guide',
      contentHash: 'doc-hash',
      indexGeneration: 'v2',
    };
    const chunks = [
      {
        id: 'chunk-1',
        docId: 'doc-safe',
        chunkIndex: 0,
        content: 'Stored authoritative content',
        contentHash: 'chunk-hash',
        indexGeneration: 'v2',
        headingPath: '[]',
        roleScope: '[]',
        hypotheticalQuestions: '[]',
      },
    ];
    const deleteDocument = jest.fn();
    const updateMetadata = jest.fn();
    const service = createService({
      docMetaRepo: {
        findOne: jest.fn().mockResolvedValue(document),
        update: updateMetadata,
      },
      chunkRepo: { find: jest.fn().mockResolvedValue(chunks) },
      documentService: { delete: deleteDocument },
      embeddingProvider: {
        embedDocuments: jest.fn().mockResolvedValue([[0.1]]),
      },
      vectorStoreProvider: {
        deleteByDocId: jest.fn().mockResolvedValue(undefined),
        insert: jest.fn().mockResolvedValue(undefined),
      },
      karpathyRagService: {
        removeDocChunks: jest.fn(),
        indexChunks: jest.fn(),
      },
      elasticsearchProvider: { isEnabled: jest.fn().mockReturnValue(false) },
      graphService: { isEnabled: jest.fn().mockReturnValue(false) },
      logger: { log: jest.fn(), error: jest.fn() },
    });

    const result = await service.reindexDocument('doc-safe');

    expect(result).toEqual(
      expect.objectContaining({
        reindexed: true,
        preserved: { tenantId: 'tenant-1', permissions: true },
      }),
    );
    expect(deleteDocument).not.toHaveBeenCalled();
    expect(updateMetadata).not.toHaveBeenCalled();
    expect(document.tenantId).toBe('tenant-1');
  });
});
