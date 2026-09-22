import { IndexRepairQueueService } from './index-repair-queue.service';
import { IndexReconcilerService } from './index-reconciler.service';

describe('IndexReconcilerService', () => {
  function create(overrides: Record<string, unknown> = {}) {
    const values = {
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

  it('fails closed when the persistent repair queue is unavailable', async () => {
    const { service } = create();
    (service as any).repairQueue.isEnabled.mockReturnValue(false);

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

    await expect(service.runOnce()).resolves.toEqual({
      available: false,
      reason: 'disabled',
    });
    expect(ragAdmin.auditDocumentIndexes).not.toHaveBeenCalled();
  });
});
