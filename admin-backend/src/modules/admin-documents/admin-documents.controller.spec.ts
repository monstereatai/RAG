import { AUDIT_LOG_KEY } from '../../common/decorators/audit-log.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { AdminDocumentsController } from './admin-documents.controller';

describe('AdminDocumentsController document operations', () => {
  const ragClient = {
    getDocumentQueueStatus: jest.fn(),
    getPendingDocumentTasks: jest.fn(),
    getFailedDocumentTasks: jest.fn(),
    getIndexRepairQueueStatus: jest.fn(),
    getFailedIndexRepairs: jest.fn(),
    getIndexReconcilerStatus: jest.fn(),
    retryIndexRepair: jest.fn(),
    runIndexReconciler: jest.fn(),
    cancelQueuedDocumentTask: jest.fn(),
  };
  const controller = new AdminDocumentsController(ragClient as never);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('aggregates queue status, failed tasks, repairs and reconciler status', async () => {
    ragClient.getDocumentQueueStatus.mockResolvedValue({
      available: true,
      status: 200,
      data: { code: 200, data: { enabled: true, waiting: 2, failed: 1 } },
    });
    ragClient.getPendingDocumentTasks.mockResolvedValue({
      available: true,
      status: 200,
      data: {
        code: 200,
        data: {
          enabled: true,
          tasks: [{ id: 'pending-1', filename: 'draft.pdf' }],
        },
      },
    });
    ragClient.getFailedDocumentTasks.mockResolvedValue({
      available: true,
      status: 200,
      data: { code: 200, data: [{ id: 'task-1', errorMessage: 'parse failed' }] },
    });
    ragClient.getIndexRepairQueueStatus.mockResolvedValue({
      available: true,
      status: 200,
      data: { code: 200, data: { enabled: true, waiting: 1, failed: 0 } },
    });
    ragClient.getFailedIndexRepairs.mockResolvedValue({
      available: true,
      status: 200,
      data: { code: 200, data: [{ id: 'repair-1', failedReason: 'timeout' }] },
    });
    ragClient.getIndexReconcilerStatus.mockResolvedValue({
      available: true,
      status: 200,
      data: { code: 200, data: { enabled: true, running: false } },
    });

    await expect(controller.operations()).resolves.toEqual({
      documentQueue: { enabled: true, waiting: 2, failed: 1 },
      pendingDocumentTasks: [{ id: 'pending-1', filename: 'draft.pdf' }],
      failedDocumentTasks: [{ id: 'task-1', errorMessage: 'parse failed' }],
      indexRepairQueue: { enabled: true, waiting: 1, failed: 0 },
      failedIndexRepairs: [{ id: 'repair-1', failedReason: 'timeout' }],
      indexReconciler: { enabled: true, running: false },
    });
    expect(ragClient.getFailedDocumentTasks).toHaveBeenCalledWith(50);
    expect(ragClient.getPendingDocumentTasks).toHaveBeenCalledWith(50);
    expect(ragClient.getFailedIndexRepairs).toHaveBeenCalledWith(50);
  });

  it('fails the operations response when the upstream status is unavailable', async () => {
    ragClient.getDocumentQueueStatus.mockResolvedValue({
      available: false,
      status: null,
      error: 'upstream unavailable',
    });
    ragClient.getFailedDocumentTasks.mockResolvedValue({ available: true, status: 200, data: [] });
    ragClient.getPendingDocumentTasks.mockResolvedValue({ available: true, status: 200, data: [] });
    ragClient.getIndexRepairQueueStatus.mockResolvedValue({ available: true, status: 200, data: {} });
    ragClient.getFailedIndexRepairs.mockResolvedValue({ available: true, status: 200, data: [] });
    ragClient.getIndexReconcilerStatus.mockResolvedValue({ available: true, status: 200, data: {} });

    await expect(controller.operations()).rejects.toThrow('upstream unavailable');
  });

  it('protects and audits manual repair actions', () => {
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.retryIndexRepair),
    ).toEqual(['admin:documents:write']);
    expect(Reflect.getMetadata(AUDIT_LOG_KEY, controller.retryIndexRepair)).toEqual({
      module: 'documents',
      action: 'retry-index-repair',
    });
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.runIndexReconciler),
    ).toEqual(['admin:documents:write']);
    expect(Reflect.getMetadata(AUDIT_LOG_KEY, controller.runIndexReconciler)).toEqual({
      module: 'documents',
      action: 'run-index-reconciler',
    });
  });

  it('forwards the repair retry and manual reconciliation requests', async () => {
    ragClient.retryIndexRepair.mockResolvedValue({ retried: true });
    ragClient.runIndexReconciler.mockResolvedValue({ available: true, queued: 2 });

    await expect(controller.retryIndexRepair('repair-1')).resolves.toEqual({ retried: true });
    await expect(controller.runIndexReconciler()).resolves.toEqual({ available: true, queued: 2 });
    expect(ragClient.retryIndexRepair).toHaveBeenCalledWith('repair-1');
    expect(ragClient.runIndexReconciler).toHaveBeenCalledTimes(1);
  });

  it('protects and audits queue cancellation and forwards the request', async () => {
    ragClient.cancelQueuedDocumentTask.mockResolvedValue({
      available: true,
      status: 200,
      data: { code: 200, data: { taskId: 'task-1', cancelled: false, reason: '任务已处理中，无法中断。' } },
    });

    await expect(controller.cancelQueuedTask('task-1')).resolves.toEqual({
      taskId: 'task-1',
      cancelled: false,
      reason: '任务已处理中，无法中断。',
    });
    expect(ragClient.cancelQueuedDocumentTask).toHaveBeenCalledWith('task-1');
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.cancelQueuedTask)).toEqual([
      'admin:documents:write',
    ]);
    expect(Reflect.getMetadata(AUDIT_LOG_KEY, controller.cancelQueuedTask)).toEqual({
      module: 'documents',
      action: 'cancel-queued-task',
    });
  });
});
