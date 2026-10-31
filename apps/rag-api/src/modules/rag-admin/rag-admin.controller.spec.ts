import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
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

  it('accepts the legacy subjects payload and normalizes public subjects', async () => {
    await controller.updateDocumentPermissions('doc-1', {
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

  it('accepts the admin permissions payload, ignores scope and drops invalid rows', async () => {
    await controller.updateDocumentPermissions('doc-1', {
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

  it('keeps the clear-all semantics for empty arrays', async () => {
    await controller.updateDocumentPermissions('doc-1', { permissions: [] });

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

  it('uses the mapped Admin principal and configured tenant for image search', () => {
    service.searchImages.mockReturnValue({ results: [] });
    const adminUserId = `admin:${'a'.repeat(58)}`;
    const originalTenantId = process.env.RAG_ADMIN_TENANT_ID;
    process.env.RAG_ADMIN_TENANT_ID = 'tenant-a';

    try {
      expect(controller.searchImages('chart', '12', adminUserId)).toEqual({
        results: [],
      });
      expect(service.searchImages).toHaveBeenCalledWith(
        'chart',
        12,
        adminUserId,
        'tenant-a',
        'admin',
        true,
      );
    } finally {
      if (originalTenantId === undefined) {
        delete process.env.RAG_ADMIN_TENANT_ID;
      } else {
        process.env.RAG_ADMIN_TENANT_ID = originalTenantId;
      }
    }
  });

  it('validates uploaded images and searches within the mapped Admin scope', () => {
    service.searchImagesByImage.mockReturnValue({ results: [] });
    const adminUserId = `admin:${'b'.repeat(58)}`;
    const originalTenantId = process.env.RAG_ADMIN_TENANT_ID;
    process.env.RAG_ADMIN_TENANT_ID = 'tenant-a';

    try {
      expect(
        controller.searchImagesByImage(
          {
            buffer: Buffer.from('png'),
            mimetype: 'image/png',
          } as Express.Multer.File,
          '12',
          adminUserId,
        ),
      ).toEqual({ results: [] });
      expect(service.searchImagesByImage).toHaveBeenCalledWith(
        Buffer.from('png').toString('base64'),
        'image/png',
        12,
        adminUserId,
        'tenant-a',
        'admin',
        true,
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
    } finally {
      if (originalTenantId === undefined) {
        delete process.env.RAG_ADMIN_TENANT_ID;
      } else {
        process.env.RAG_ADMIN_TENANT_ID = originalTenantId;
      }
    }
  });

  it('streams an image asset only after the service has applied its ACL check', async () => {
    const image = { buffer: Buffer.from('png-data'), contentType: 'image/png' };
    const setHeaderMock = jest.fn();
    const sendMock = jest.fn();
    const response = {
      setHeader: setHeaderMock,
      send: sendMock,
    } as unknown as Response;
    service.getImageAsset.mockResolvedValue(image);
    const adminUserId = `admin:${'a'.repeat(58)}`;
    const originalTenantId = process.env.RAG_ADMIN_TENANT_ID;
    process.env.RAG_ADMIN_TENANT_ID = 'tenant-a';

    try {
      await controller.getImageAsset(
        adminUserId,
        'doc-1',
        'documents/owner-1/doc-1/images/page-1.png',
        response,
      );
    } finally {
      if (originalTenantId === undefined) {
        delete process.env.RAG_ADMIN_TENANT_ID;
      } else {
        process.env.RAG_ADMIN_TENANT_ID = originalTenantId;
      }
    }

    expect(service.getImageAsset).toHaveBeenCalledWith({
      userId: adminUserId,
      tenantId: 'tenant-a',
      role: 'admin',
      trustedAdminPrincipal: true,
      docId: 'doc-1',
      key: 'documents/owner-1/doc-1/images/page-1.png',
    });
    expect(setHeaderMock).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(setHeaderMock).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(sendMock).toHaveBeenCalledWith(image.buffer);
  });
});
