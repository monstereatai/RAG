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
});
