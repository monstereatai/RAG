import { RagAdminService } from './rag-admin.service';

describe('RagAdminService index reconciliation', () => {
  const healthyDescriptionAudit = {
    documentFound: true,
    docVersion: 'v1',
    indexGeneration: 'generation-1',
    lifecycleStatus: 'effective',
    reviewStatus: 'approved',
    effectiveAt: null,
    expiredAt: null,
    expectedCount: 1,
    pgCount: 1,
    milvusCount: 1,
    missingCount: 0,
    staleCount: 0,
    missingPgCount: 0,
    stalePgCount: 0,
    missingMilvusCount: 0,
    staleMilvusCount: 0,
    contentMismatchCount: 0,
    sourceMappingMismatchCount: 0,
  };

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
      retrievalDescriptionService: {
        auditForDocument: jest.fn().mockResolvedValue(healthyDescriptionAudit),
        rebuild: jest.fn().mockResolvedValue({ documents: 1, descriptions: 1 }),
      },
      graphService: {
        isEnabled: jest.fn().mockReturnValue(false),
      },
      ...overrides,
    });
    return service as unknown as RagAdminService;
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
          retrievalDescriptions: expect.objectContaining({
            status: 'ok',
            expected: 1,
            pgCount: 1,
            milvusCount: 1,
          }),
        }),
      }),
    );
  });

  it('reports missing and stale PostgreSQL or Milvus retrieval descriptions', async () => {
    const service = createService({
      retrievalDescriptionService: {
        auditForDocument: jest.fn().mockResolvedValue({
          documentFound: true,
          docVersion: 'v1',
          indexGeneration: 'generation-1',
          lifecycleStatus: 'effective',
          reviewStatus: 'approved',
          effectiveAt: null,
          expiredAt: null,
          expectedCount: 2,
          pgCount: 2,
          milvusCount: 1,
          missingCount: 1,
          staleCount: 1,
          missingPgCount: 0,
          stalePgCount: 1,
          missingMilvusCount: 1,
          staleMilvusCount: 0,
          contentMismatchCount: 1,
          sourceMappingMismatchCount: 0,
        }),
      },
    });

    const result = await service.auditDocumentIndexes(10);

    expect(result.issueCount).toBe(1);
    expect(result.issues[0].reasons).toEqual(
      expect.arrayContaining([
        'retrieval_description_stale_pg',
        'retrieval_description_missing_milvus',
        'retrieval_description_content_mismatch',
      ]),
    );
    expect(result.issues[0].checks.retrievalDescriptions).toEqual(
      expect.objectContaining({
        status: 'mismatch',
        expected: 2,
        pgCount: 2,
        milvusCount: 1,
        missingCount: 1,
        staleCount: 1,
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

  it('repairs only descriptions without embedding raw chunks when no queue is configured', async () => {
    const auditForDocument = jest
      .fn()
      .mockResolvedValueOnce({
        ...healthyDescriptionAudit,
        milvusCount: 0,
        missingCount: 1,
        missingMilvusCount: 1,
      })
      .mockResolvedValueOnce(healthyDescriptionAudit);
    const rebuild = jest.fn().mockResolvedValue({
      documents: 1,
      descriptions: 1,
    });
    const embedDocuments = jest.fn();
    const service = createService({
      docMetaRepo: {
        find: jest.fn().mockResolvedValue([
          {
            docId: 'doc-1',
            tenantId: 'tenant-1',
            filename: 'guide.md',
            userId: 'user-1',
            chunkCount: 2,
            graphIndexStatus: 'skipped',
            lifecycleStatus: 'draft',
            reviewStatus: 'draft',
            expiredAt: null,
          },
        ]),
        findOne: jest.fn().mockResolvedValue({
          docId: 'doc-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          chunkCount: 2,
        }),
      },
      retrievalDescriptionService: { auditForDocument, rebuild },
      embeddingProvider: { embedDocuments },
    });

    const result = await service.repairDocumentIndexes({ limit: 10 });

    expect(result.results?.[0]).toEqual(
      expect.objectContaining({ reindexed: true, descriptionOnly: true }),
    );
    expect(rebuild).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      docId: 'doc-1',
    });
    expect(embedDocuments).not.toHaveBeenCalled();
  });

  it('routes queued description-only jobs through the description repair helper', async () => {
    const processorRef: {
      handler?: (job: {
        id: string;
        docId: string;
        requestedBy: string;
        reason?: string;
      }) => Promise<void>;
    } = {};
    const auditForDocument = jest
      .fn()
      .mockResolvedValue(healthyDescriptionAudit);
    const rebuild = jest.fn().mockResolvedValue({
      documents: 1,
      descriptions: 1,
    });
    const embedDocuments = jest.fn();
    const service = createService({
      docMetaRepo: {
        findOne: jest.fn().mockResolvedValue({
          docId: 'doc-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          chunkCount: 2,
        }),
      },
      retrievalDescriptionService: { auditForDocument, rebuild },
      embeddingProvider: { embedDocuments },
      indexRepairQueue: {
        registerProcessor: jest.fn((handler: typeof processorRef.handler) => {
          processorRef.handler = handler;
        }),
      },
    });

    service.onModuleInit();
    const processor = processorRef.handler;
    if (!processor) throw new Error('index repair processor not registered');
    await processor({
      id: 'repair-1',
      docId: 'doc-1',
      requestedBy: 'rag-admin',
      reason:
        'retrieval_description_missing_milvus,retrieval_description_stale_pg',
    });

    expect(rebuild).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      docId: 'doc-1',
    });
    expect(embedDocuments).not.toHaveBeenCalled();
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
    const retrievalDescriptionService = {
      rebuild: jest.fn().mockResolvedValue({ documents: 1, descriptions: 1 }),
      auditForDocument: jest.fn().mockResolvedValue({
        ...healthyDescriptionAudit,
        docVersion: null,
        indexGeneration: 'v2',
        lifecycleStatus: 'draft',
        reviewStatus: 'draft',
      }),
    };
    const embedDocuments = jest.fn().mockResolvedValue([[0.1]]);
    const service = createService({
      docMetaRepo: {
        findOne: jest.fn().mockResolvedValue(document),
        update: updateMetadata,
      },
      chunkRepo: { find: jest.fn().mockResolvedValue(chunks) },
      documentService: {
        delete: deleteDocument,
        rebuildImageIndexFromOriginal: jest.fn().mockResolvedValue(undefined),
      },
      embeddingProvider: {
        embedDocuments,
      },
      vectorStoreProvider: {
        deleteByDocId: jest.fn().mockResolvedValue(undefined),
        insert: jest.fn().mockResolvedValue(undefined),
        countByDocId: jest.fn().mockResolvedValue(1),
      },
      karpathyRagService: {
        removeDocChunks: jest.fn(),
        indexChunks: jest.fn(),
      },
      elasticsearchProvider: { isEnabled: jest.fn().mockReturnValue(false) },
      graphService: { isEnabled: jest.fn().mockReturnValue(false) },
      logger: { log: jest.fn(), error: jest.fn() },
      retrievalDescriptionService,
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
    expect(embedDocuments).toHaveBeenCalledWith([
      'Stored authoritative content',
    ]);
    expect(retrievalDescriptionService.rebuild).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      docId: 'doc-safe',
    });
    expect(retrievalDescriptionService.auditForDocument).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      docId: 'doc-safe',
    });
  });
});
