import { BadRequestException } from '@nestjs/common';
import { RagAdminController } from './rag-admin.controller';

describe('RagAdminController permission contract', () => {
  const service = { updateDocumentPermissions: jest.fn() };
  const controller = new RagAdminController(
    service as never,
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
        { subjectType: 'guest', subjectId: 'x' },
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
});
