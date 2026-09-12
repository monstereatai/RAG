import { BadRequestException } from '@nestjs/common';
import { RagAdminService } from './rag-admin.service';

describe('RagAdminService document versions', () => {
  const docMetaRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const documentService = {
    activateVersion: jest.fn(),
    updateLifecycle: jest.fn(),
  };
  const ingest = { ingestText: jest.fn() };
  const documentReviewRepo = {
    save: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
  };
  const permissionRepo = { find: jest.fn() };

  const service = new RagAdminService(
    {} as never,
    documentService as never,
    {} as never,
    ingest as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    docMetaRepo as never,
    documentReviewRepo as never,
    {} as never,
    permissionRepo as never,
    { emit: jest.fn() } as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('creates replacement versions as drafts', async () => {
    docMetaRepo.findOne.mockResolvedValue({
      docId: 'old',
      userId: 'user-1',
      filename: 'rule.md',
      projectId: null,
      activityId: null,
      region: null,
      locale: null,
      channel: null,
      roleScope: null,
      documentType: 'general',
    });
    ingest.ingestText.mockResolvedValue({
      rag: { docId: 'new' },
      obsidian: {},
    });

    await service.createDocumentVersion('old', {
      content: '# 新规则\n\n正文内容足够长。',
      lifecycleStatus: 'effective',
    });

    expect(ingest.ingestText).toHaveBeenCalledWith(
      expect.objectContaining({
        businessMetadata: expect.objectContaining({
          lifecycleStatus: 'draft',
          supersedesDocId: 'old',
        }),
      }),
    );
  });

  it('promotes one complete version and passes the full version chain', async () => {
    docMetaRepo.findOne.mockResolvedValue({
      docId: 'new',
      userId: 'user-1',
      reviewStatus: 'approved',
    });
    docMetaRepo.find.mockResolvedValue([
      { docId: 'old', userId: 'user-1', createdAt: new Date('2026-01-01') },
      {
        docId: 'new',
        userId: 'user-1',
        supersedesDocId: 'old',
        createdAt: new Date('2026-02-01'),
      },
    ]);
    documentService.activateVersion.mockResolvedValue(true);

    await expect(service.promoteDocumentVersion('new')).resolves.toEqual({
      docId: 'new',
      lifecycleStatus: 'effective',
    });
    expect(documentService.activateVersion).toHaveBeenCalledWith(
      'new',
      'user-1',
      ['old', 'new'],
    );
  });

  it('does not promote a version before it is approved', async () => {
    docMetaRepo.findOne.mockResolvedValue({
      docId: 'draft',
      userId: 'user-1',
      reviewStatus: 'pending_review',
    });

    await expect(service.promoteDocumentVersion('draft')).rejects.toThrow(
      'document must be approved before promotion',
    );
    expect(documentService.activateVersion).not.toHaveBeenCalled();
  });

  it('uses the same promotion path for rollback', async () => {
    jest.spyOn(service, 'promoteDocumentVersion').mockResolvedValue({
      docId: 'old',
      lifecycleStatus: 'effective',
    });
    jest.spyOn(service, 'listDocumentVersions').mockResolvedValue([]);

    await expect(service.rollbackDocumentVersion('old')).resolves.toEqual({
      activeDocId: 'old',
      versions: [],
    });
  });
});

describe('RagAdminService document listing and archive', () => {
  const docMetaRepo = { findOne: jest.fn(), find: jest.fn() };
  const permissionRepo = { find: jest.fn() };
  const obsidianKnowledge = { findNoteByRagDocId: jest.fn() };
  const elasticsearchProvider = { isEnabled: jest.fn(() => false) };
  const documentService = {
    updateLifecycle: jest.fn(),
    activateVersion: jest.fn(),
  };
  const domainEvents = { emit: jest.fn() };

  const service = new RagAdminService(
    {} as never,
    documentService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    elasticsearchProvider as never,
    {} as never,
    {} as never,
    obsidianKnowledge as never,
    {} as never,
    docMetaRepo as never,
    {} as never,
    {} as never,
    permissionRepo as never,
    domainEvents as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    obsidianKnowledge.findNoteByRagDocId.mockResolvedValue(null);
    domainEvents.emit.mockResolvedValue(undefined);
    // 默认：无权限行（scope 查询与权限摘要查询共用）
    permissionRepo.find.mockResolvedValue([]);
  });

  it('filters documents by lifecycleStatus', async () => {
    docMetaRepo.find.mockResolvedValue([
      {
        docId: 'a',
        filename: 'a.md',
        createdAt: new Date(),
        lifecycleStatus: 'effective',
      },
      {
        docId: 'b',
        filename: 'b.md',
        createdAt: new Date(),
        lifecycleStatus: 'archived',
      },
    ]);

    const result = await service.listDocuments({ lifecycleStatus: 'archived' });

    expect(result.total).toBe(1);
    expect(result.items[0].docId).toBe('b');
  });

  it('queries documents by latest upload time first with a stable id tie-breaker', async () => {
    docMetaRepo.find.mockResolvedValue([]);

    await service.listDocuments({});

    expect(docMetaRepo.find).toHaveBeenCalledWith({
      order: { createdAt: 'DESC', docId: 'DESC' },
    });
  });

  it('filters public documents by permission scope and returns permission summary', async () => {
    docMetaRepo.find.mockResolvedValue([
      {
        docId: 'pub-1',
        filename: 'p1.md',
        createdAt: new Date(),
        lifecycleStatus: 'effective',
      },
      {
        docId: 'own-1',
        filename: 'p2.md',
        createdAt: new Date(),
        lifecycleStatus: 'effective',
      },
    ]);
    permissionRepo.find.mockResolvedValue([
      {
        docId: 'pub-1',
        subjectType: 'public',
        subjectId: 'public',
        action: 'read',
      },
    ]);

    const result = await service.listDocuments({ scope: 'public' });

    expect(permissionRepo.find).toHaveBeenCalledWith({
      where: { subjectType: 'public', action: 'read' },
    });
    expect(result.total).toBe(1);
    expect(result.items[0].docId).toBe('pub-1');
    expect(result.items[0].permissions).toEqual([
      { subjectType: 'public', subjectId: 'public' },
    ]);
  });

  it('filters department documents by departmentId', async () => {
    docMetaRepo.find.mockResolvedValue([
      {
        docId: 'dept-1',
        filename: 'd1.md',
        createdAt: new Date(),
        lifecycleStatus: 'effective',
      },
    ]);
    permissionRepo.find.mockResolvedValue([
      {
        docId: 'dept-1',
        subjectType: 'department',
        subjectId: 'dept-001',
        action: 'read',
      },
    ]);

    const result = await service.listDocuments({
      scope: 'department',
      departmentId: 'dept-001',
    });

    expect(permissionRepo.find).toHaveBeenCalledWith({
      where: {
        subjectType: 'department',
        action: 'read',
        subjectId: 'dept-001',
      },
    });
    expect(result.total).toBe(1);
    expect(result.items[0].docId).toBe('dept-1');
  });

  it('returns an empty page when the scope permission set is empty', async () => {
    docMetaRepo.find.mockResolvedValue([
      {
        docId: 'a',
        filename: 'a.md',
        createdAt: new Date(),
        lifecycleStatus: 'effective',
      },
    ]);

    await expect(service.listDocuments({ scope: 'public' })).resolves.toEqual({
      total: 0,
      page: 1,
      pageSize: 20,
      items: [],
    });
  });

  it('archives only effective/confirmed documents', async () => {
    docMetaRepo.findOne.mockResolvedValue({
      docId: 'd',
      userId: 'user-1',
      lifecycleStatus: 'draft',
    });

    await expect(service.archiveDocument('d')).rejects.toThrow(
      new BadRequestException(
        'document lifecycle status is draft, only effective/confirmed documents can be archived',
      ),
    );
    expect(documentService.updateLifecycle).not.toHaveBeenCalled();
  });

  it('archives an effective document through the lifecycle sync path', async () => {
    docMetaRepo.findOne.mockResolvedValue({
      docId: 'd',
      userId: 'user-1',
      lifecycleStatus: 'effective',
    });
    documentService.updateLifecycle.mockResolvedValue(true);

    await expect(service.archiveDocument('d')).resolves.toEqual({
      docId: 'd',
      archived: true,
      lifecycleStatus: 'archived',
    });
    expect(documentService.updateLifecycle).toHaveBeenCalledWith(
      'd',
      'user-1',
      'archived',
    );
    expect(domainEvents.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'document.lifecycle_changed' }),
    );
  });

  it('rejects unarchive for a document that is not archived', async () => {
    docMetaRepo.findOne.mockResolvedValue({
      docId: 'd',
      userId: 'user-1',
      lifecycleStatus: 'effective',
    });

    await expect(service.unarchiveDocument('d')).rejects.toThrow(
      'only archived documents can be unarchived',
    );
  });

  it('rejects unarchive before the document is approved', async () => {
    docMetaRepo.findOne.mockResolvedValue({
      docId: 'd',
      userId: 'user-1',
      lifecycleStatus: 'archived',
      reviewStatus: 'pending_review',
    });

    await expect(service.unarchiveDocument('d')).rejects.toThrow(
      'document must be approved before unarchive',
    );
  });

  it('unarchives an approved archived document back to effective', async () => {
    docMetaRepo.findOne.mockResolvedValue({
      docId: 'd',
      userId: 'user-1',
      lifecycleStatus: 'archived',
      reviewStatus: 'approved',
    });
    docMetaRepo.find.mockResolvedValue([
      { docId: 'd', userId: 'user-1', createdAt: new Date() },
    ]);
    documentService.activateVersion.mockResolvedValue(true);

    await expect(service.unarchiveDocument('d')).resolves.toEqual({
      docId: 'd',
      unarchived: true,
      lifecycleStatus: 'effective',
    });
    // effective 走版本激活路径（promote）
    expect(documentService.activateVersion).toHaveBeenCalledWith(
      'd',
      'user-1',
      ['d'],
    );
  });
});
