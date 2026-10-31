import { IndexReconcilerService } from './index-reconciler.service';

describe('IndexReconcilerService', () => {
  function create(overrides: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = {
      nodeEnv: 'production',
      'ragIndexReconciler.enabled': true,
      'ragIndexReconciler.intervalMs': 60_000,
      'ragIndexReconciler.batchSize': 10,
      ...overrides,
    };
    const config = { get: jest.fn((key: string) => values[key]) };
    const ragAdmin = { auditDocumentIndexes: jest.fn() };
    const repairQueue = {
      isEnabled: jest.fn().mockReturnValue(true),
      enqueue: jest.fn().mockResolvedValue(true),
    };
    return {
      service: new IndexReconcilerService(
        config as never,
        ragAdmin as never,
        repairQueue as never,
      ),
      ragAdmin,
      repairQueue,
    };
  }

  it('queues only repairable index mismatches', async () => {
    const { service, ragAdmin, repairQueue } = create();
    ragAdmin.auditDocumentIndexes.mockResolvedValue({
      scanned: 4,
      issues: [
        { docId: 'doc-1', reasons: ['bm25_chunk_count_mismatch'] },
        { docId: 'doc-2', reasons: ['effective_without_approval'] },
        { docId: 'doc-3', reasons: ['graph_index_missing'] },
        { docId: 'doc-4', reasons: ['elasticsearch_content_hash_mismatch'] },
      ],
    });

    await expect(service.runOnce()).resolves.toEqual({
      available: true,
      scanned: 4,
      mismatched: 3,
      queued: 3,
      skipped: 1,
    });
    expect(repairQueue.enqueue).toHaveBeenCalledTimes(3);
    expect(repairQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 'doc-1',
        requestedBy: 'index-reconciler',
      }),
    );
    expect(repairQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 'doc-3',
        requestedBy: 'index-reconciler',
      }),
    );
    expect(repairQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 'doc-4',
        requestedBy: 'index-reconciler',
      }),
    );
  });

  it('queues confirmed vector, image, and retrieval-description repairs only', async () => {
    const { service, ragAdmin, repairQueue } = create();
    const repairableReasons = [
      'milvus_chunk_count_mismatch',
      'image_index_count_mismatch',
      'retrieval_description_document_missing',
      'retrieval_description_missing_pg',
      'retrieval_description_stale_pg',
      'retrieval_description_missing_milvus',
      'retrieval_description_stale_milvus',
      'retrieval_description_content_mismatch',
      'retrieval_description_source_mapping_mismatch',
      'retrieval_description_missing',
      'retrieval_description_stale',
      'retrieval_description_count_mismatch',
    ];
    const skippedReasons = [
      'milvus_unavailable',
      'image_index_unavailable',
      'retrieval_description_audit_unavailable',
      'metadata_chunk_count_mismatch',
    ];
    ragAdmin.auditDocumentIndexes.mockResolvedValue({
      scanned: repairableReasons.length + skippedReasons.length,
      issues: [
        ...repairableReasons.map((reason, index) => ({
          docId: `repairable-${index}`,
          reasons: [reason],
        })),
        ...skippedReasons.map((reason, index) => ({
          docId: `skipped-${index}`,
          reasons: [reason],
        })),
      ],
    });

    await expect(service.runOnce()).resolves.toEqual({
      available: true,
      scanned: repairableReasons.length + skippedReasons.length,
      mismatched: repairableReasons.length,
      queued: repairableReasons.length,
      skipped: skippedReasons.length,
    });
    expect(repairQueue.enqueue).toHaveBeenCalledTimes(repairableReasons.length);
    repairableReasons.forEach((_, index) => {
      expect(repairQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ docId: `repairable-${index}` }),
      );
    });
    skippedReasons.forEach((_, index) => {
      expect(repairQueue.enqueue).not.toHaveBeenCalledWith(
        expect.objectContaining({ docId: `skipped-${index}` }),
      );
    });
  });

  it('retries the same audit page when enqueueing a repair job fails', async () => {
    const { service, ragAdmin, repairQueue } = create();
    const cursor = {
      createdAt: '2026-10-31T00:00:00.000Z',
      docId: 'doc-2',
    };
    const page = {
      scanned: 10,
      nextCursor: cursor,
      issues: [
        { docId: 'doc-1', reasons: ['bm25_chunk_count_mismatch'] },
        { docId: 'doc-2', reasons: ['elasticsearch_index_count_mismatch'] },
      ],
    };
    ragAdmin.auditDocumentIndexes
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce({ scanned: 0, nextCursor: null, issues: [] });
    repairQueue.enqueue
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(service.runOnce()).resolves.toEqual({
      available: false,
      reason: 'redis unavailable',
    });
    expect(ragAdmin.auditDocumentIndexes).toHaveBeenNthCalledWith(
      1,
      10,
      undefined,
    );

    await expect(service.runOnce()).resolves.toEqual({
      available: true,
      scanned: 10,
      mismatched: 2,
      queued: 2,
      skipped: 0,
    });
    expect(ragAdmin.auditDocumentIndexes).toHaveBeenNthCalledWith(
      2,
      10,
      undefined,
    );
    expect(repairQueue.enqueue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ docId: 'doc-1' }),
    );
    expect(repairQueue.enqueue).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ docId: 'doc-1' }),
    );

    await service.runOnce();
    expect(ragAdmin.auditDocumentIndexes).toHaveBeenNthCalledWith(
      3,
      10,
      cursor,
    );
  });

  it('fails closed when the persistent repair queue is unavailable', async () => {
    const { service, repairQueue } = create();
    repairQueue.isEnabled.mockReturnValue(false);

    await expect(service.runOnce()).resolves.toEqual({
      available: false,
      reason: 'repair_queue_unavailable',
    });
  });

  it('is disabled by default outside production', async () => {
    const { service, ragAdmin } = create({
      nodeEnv: 'development',
      'ragIndexReconciler.enabled': undefined,
    });

    await expect(service.runOnce('interval')).resolves.toEqual({
      available: false,
      reason: 'disabled',
    });
    expect(ragAdmin.auditDocumentIndexes).not.toHaveBeenCalled();
  });

  it('allows a manual run when scheduling is disabled but the persistent queue is available', async () => {
    const { service, ragAdmin, repairQueue } = create({
      nodeEnv: 'development',
      'ragIndexReconciler.enabled': undefined,
    });
    ragAdmin.auditDocumentIndexes.mockResolvedValue({ scanned: 0, issues: [] });

    await expect(service.runOnce('manual')).resolves.toEqual({
      available: true,
      scanned: 0,
      mismatched: 0,
      queued: 0,
      skipped: 0,
    });
    expect(ragAdmin.auditDocumentIndexes).toHaveBeenCalledTimes(1);
    expect(repairQueue.enqueue).not.toHaveBeenCalled();
  });
});
