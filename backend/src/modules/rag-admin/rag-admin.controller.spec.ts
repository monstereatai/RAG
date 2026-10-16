import { BadRequestException } from '@nestjs/common';
import { RagAdminController } from './rag-admin.controller';

describe('RagAdminController permission contract', () => {
  const service = {
    updateDocumentPermissions: jest.fn(),
    getDocumentQueueStatus: jest.fn(),
    getPendingDocumentTasks: jest.fn(),
    cancelQueuedDocumentTask: jest.fn(),
    searchImages: jest.fn(),
    searchImagesByImage: jest.fn(),
    getImageAsset: jest.fn(),
  };
  const controller = new RagAdminController(
    service as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('accepts the legacy subjects payload and normalizes public subjects', () => {
    controller.updateDocumentPermissions('doc-1', {
      subjects: [
        { type: 'user', id: 'u1' },
        { type: 'public', id: '' },
      ],
    });

    expect(service.updateDocumentPermissions).toHaveBeenCalledWith('doc-1', [
      { type: 'user', id: 'u1' },
      { type: 'public', id: 'public' },
    ]);
  });

  it('accepts the admin permissions payload, ignores scope and drops invalid rows', () => {
    controller.updateDocumentPermissions('doc-1', {
      permissions: [
        { subjectType: 'department', subjectId: 'dept-1', scope: 'read' },
        { subjectType: 'user', subjectId: '' },
        { subjectType: 'guest' as never, subjectId: 'x' },
      ],
    });

    expect(service.updateDocumentPermissions).toHaveBeenCalledWith('doc-1', [
      { type: 'department', id: 'dept-1' },
    ]);
  });

  it('keeps the clear-all semantics for empty arrays', () => {
    controller.updateDocumentPermissions('doc-1', { permissions: [] });

    expect(service.updateDocumentPermissions).toHaveBeenCalledWith('doc-1', []);
  });

  it('rejects payloads without permissions or subjects', () => {
    expect(() => controller.updateDocumentPermissions('doc-1', {})).toThrow(
      BadRequestException,
    );
    expect(() => controller.updateDocumentPermissions('doc-1', {})).toThrow(
      'permissions or subjects required',
    );
  });

  it('returns document BullMQ status through the service-token admin API', async () => {
    const status = {
      enabled: true,
      waiting: 2,
      active: 1,
      completed: 8,
      failed: 3,
    };
    service.getDocumentQueueStatus.mockResolvedValue(status);

    await expect(controller.getDocumentQueueStatus()).resolves.toEqual(status);
    expect(service.getDocumentQueueStatus).toHaveBeenCalledTimes(1);
  });

  it('exposes pending tasks and queued-task cancellation through the admin API', async () => {
    const pending = { enabled: true, tasks: [{ id: 'task-1' }] };
    const cancelled = { taskId: 'task-1', cancelled: false, reason: '处理中' };
    service.getPendingDocumentTasks.mockResolvedValue(pending);
    service.cancelQueuedDocumentTask.mockResolvedValue(cancelled);

    await expect(controller.getPendingDocumentTasks('20')).resolves.toEqual(
      pending,
    );
    await expect(
      controller.cancelQueuedDocumentTask('task-1'),
    ).resolves.toEqual(cancelled);
    expect(service.getPendingDocumentTasks).toHaveBeenCalledWith(20);
    expect(service.cancelQueuedDocumentTask).toHaveBeenCalledWith('task-1');
  });

  it('passes verified user, tenant and role context to image search', () => {
    service.searchImages.mockReturnValue({ results: [] });

    expect(
      controller.searchImages('chart', '12', 'user-1', 'tenant-a', 'editor'),
    ).toEqual({ results: [] });
    expect(service.searchImages).toHaveBeenCalledWith(
      'chart',
      12,
      'user-1',
      'tenant-a',
      'editor',
    );
  });

  it('validates and passes the uploaded image with caller scope to image search', () => {
    service.searchImagesByImage.mockReturnValue({ results: [] });

    expect(
      controller.searchImagesByImage(
        {
          buffer: Buffer.from('png'),
          mimetype: 'image/png',
        } as Express.Multer.File,
        '12',
        'user-1',
        'tenant-a',
        'editor',
      ),
    ).toEqual({ results: [] });
    expect(service.searchImagesByImage).toHaveBeenCalledWith(
      Buffer.from('png').toString('base64'),
      'image/png',
      12,
      'user-1',
      'tenant-a',
      'editor',
    );
    expect(() =>
      controller.searchImagesByImage(undefined as never, undefined, 'user-1'),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.searchImagesByImage(
        {
          buffer: Buffer.from('text'),
          mimetype: 'text/plain',
        } as Express.Multer.File,
        undefined,
        'user-1',
      ),
    ).toThrow(BadRequestException);
  });

  it('streams an image asset only after the service has applied its ACL check', async () => {
    const image = { buffer: Buffer.from('png-data'), contentType: 'image/png' };
    const response = { setHeader: jest.fn(), send: jest.fn() };
    service.getImageAsset.mockResolvedValue(image);

    await controller.getImageAsset(
      'user-1',
      'tenant-a',
      'editor',
      'doc-1',
      'documents/owner-1/doc-1/images/page-1.png',
      response as never,
    );

    expect(service.getImageAsset).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: 'tenant-a',
      role: 'editor',
      docId: 'doc-1',
      key: 'documents/owner-1/doc-1/images/page-1.png',
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'image/png',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(response.send).toHaveBeenCalledWith(image.buffer);
  });
});
