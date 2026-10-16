import { ForbiddenException } from '@nestjs/common';
import { RagAdminService } from './rag-admin.service';

describe('RagAdminService image asset ACL', () => {
  const documentService = {
    getAllowedDocIdsForUser: jest.fn(),
  };
  const docMetaRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const objectStorageProvider = {
    getObject: jest.fn(),
  };
  const imageIndexService = {
    isEnabled: jest.fn(() => true),
    searchText: jest.fn(),
  };
  const service = new RagAdminService(
    {} as never,
    documentService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    docMetaRepo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    imageIndexService as never,
    undefined,
    undefined,
    objectStorageProvider as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    imageIndexService.isEnabled.mockReturnValue(true);
    documentService.getAllowedDocIdsForUser.mockResolvedValue(
      new Set(['doc-1']),
    );
    docMetaRepo.findOne.mockResolvedValue({
      docId: 'doc-1',
      userId: 'owner-1',
    });
    docMetaRepo.find.mockResolvedValue([
      {
        docId: 'doc-1',
        userId: 'owner-1',
        lifecycleStatus: 'effective',
        reviewStatus: 'approved',
        effectiveAt: null,
        expiredAt: null,
      },
    ]);
    objectStorageProvider.getObject.mockResolvedValue(Buffer.from('png-data'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('applies user, tenant and role ACL inputs to image search', async () => {
    imageIndexService.searchText.mockResolvedValue([]);

    await service.searchImages('chart', 10, 'user-1', 'tenant-a', 'editor');

    expect(documentService.getAllowedDocIdsForUser).toHaveBeenCalledWith(
      'user-1',
      'tenant-a',
      ['editor'],
    );
    expect(docMetaRepo.find).toHaveBeenCalled();
    expect(imageIndexService.searchText).toHaveBeenCalledWith('chart', {
      topK: 10,
      userId: 'user-1',
      allowedDocIds: new Set(['doc-1']),
    });
  });

  it('serves an owner image or a shared image key only when the document ACL allows it', async () => {
    const asset = await service.getImageAsset({
      userId: 'shared-user',
      tenantId: 'tenant-a',
      role: 'editor',
      docId: 'doc-1',
      key: 'documents/owner-1/doc-1/images/page-1.png',
    });

    expect(documentService.getAllowedDocIdsForUser).toHaveBeenCalledWith(
      'shared-user',
      'tenant-a',
      ['editor'],
    );
    expect(objectStorageProvider.getObject).toHaveBeenCalledWith(
      'documents/owner-1/doc-1/images/page-1.png',
    );
    expect(asset).toEqual({
      buffer: Buffer.from('png-data'),
      contentType: 'image/png',
    });
  });

  it('allows the owner to read an image from their active document', async () => {
    await expect(
      service.getImageAsset({
        userId: 'owner-1',
        tenantId: 'tenant-a',
        docId: 'doc-1',
        key: 'documents/owner-1/doc-1/images/page-1.png',
      }),
    ).resolves.toEqual({
      buffer: Buffer.from('png-data'),
      contentType: 'image/png',
    });
  });

  it('rejects a document with no user or tenant permission', async () => {
    documentService.getAllowedDocIdsForUser.mockResolvedValue(new Set());

    await expect(
      service.getImageAsset({
        userId: 'user-2',
        tenantId: 'tenant-a',
        docId: 'doc-1',
        key: 'documents/owner-1/doc-1/images/page-1.png',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(docMetaRepo.find).not.toHaveBeenCalled();
    expect(objectStorageProvider.getObject).not.toHaveBeenCalled();
  });

  it('rejects documents outside the current tenant ACL', async () => {
    documentService.getAllowedDocIdsForUser.mockImplementation(
      (_userId: string, tenantId: string) =>
        tenantId === 'tenant-a' ? new Set(['doc-1']) : new Set(),
    );

    await expect(
      service.getImageAsset({
        userId: 'user-1',
        tenantId: 'tenant-b',
        role: 'editor',
        docId: 'doc-1',
        key: 'documents/owner-1/doc-1/images/page-1.png',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(objectStorageProvider.getObject).not.toHaveBeenCalled();
  });

  it('rejects image keys that belong to another document', async () => {
    await expect(
      service.getImageAsset({
        userId: 'user-1',
        tenantId: 'tenant-a',
        docId: 'doc-1',
        key: 'documents/owner-1/doc-2/images/page-1.png',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(objectStorageProvider.getObject).not.toHaveBeenCalled();
  });

  it('excludes deprecated documents from search and blocks their image assets', async () => {
    docMetaRepo.find.mockResolvedValue([
      {
        docId: 'doc-1',
        userId: 'owner-1',
        lifecycleStatus: 'deprecated',
        reviewStatus: 'approved',
        effectiveAt: null,
        expiredAt: null,
      },
    ]);
    imageIndexService.searchText.mockResolvedValue([]);

    await service.searchImages('chart', 10, 'user-1', 'tenant-a');

    expect(imageIndexService.searchText).toHaveBeenCalledWith('chart', {
      topK: 10,
      userId: 'user-1',
      allowedDocIds: new Set(),
    });
    await expect(
      service.getImageAsset({
        userId: 'user-1',
        tenantId: 'tenant-a',
        docId: 'doc-1',
        key: 'documents/owner-1/doc-1/images/page-1.png',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(objectStorageProvider.getObject).not.toHaveBeenCalled();
  });

  it('excludes documents outside their effective and expiry window', async () => {
    const future = new Date(Date.now() + 60_000);
    docMetaRepo.find.mockResolvedValue([
      {
        docId: 'doc-1',
        userId: 'owner-1',
        lifecycleStatus: 'effective',
        reviewStatus: 'pending_review',
        effectiveAt: null,
        expiredAt: null,
      },
      {
        docId: 'doc-2',
        userId: 'owner-2',
        lifecycleStatus: 'effective',
        reviewStatus: 'approved',
        effectiveAt: future,
        expiredAt: null,
      },
      {
        docId: 'doc-3',
        userId: 'owner-3',
        lifecycleStatus: 'effective',
        reviewStatus: 'approved',
        effectiveAt: null,
        expiredAt: new Date(Date.now() - 60_000),
      },
    ]);
    documentService.getAllowedDocIdsForUser.mockResolvedValue(
      new Set(['doc-1', 'doc-2', 'doc-3']),
    );
    imageIndexService.searchText.mockResolvedValue([]);

    await service.searchImages('chart', 10, 'user-1', 'tenant-a');

    expect(imageIndexService.searchText).toHaveBeenCalledWith('chart', {
      topK: 10,
      userId: 'user-1',
      allowedDocIds: new Set(),
    });
  });

  it('allows effectiveAt equality but excludes expiredAt equality', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
    docMetaRepo.find.mockResolvedValue([
      {
        docId: 'doc-effective',
        userId: 'owner-1',
        lifecycleStatus: 'effective',
        reviewStatus: 'approved',
        effectiveAt: new Date(1_000),
        expiredAt: null,
      },
      {
        docId: 'doc-expired',
        userId: 'owner-2',
        lifecycleStatus: 'effective',
        reviewStatus: 'approved',
        effectiveAt: null,
        expiredAt: new Date(1_000),
      },
    ]);
    documentService.getAllowedDocIdsForUser.mockResolvedValue(
      new Set(['doc-effective', 'doc-expired']),
    );
    imageIndexService.searchText.mockResolvedValue([]);

    await service.searchImages('chart', 10, 'user-1', 'tenant-a');

    expect(imageIndexService.searchText).toHaveBeenCalledWith('chart', {
      topK: 10,
      userId: 'user-1',
      allowedDocIds: new Set(['doc-effective']),
    });
  });
});
