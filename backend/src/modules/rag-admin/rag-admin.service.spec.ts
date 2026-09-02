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
  const documentReviewRepo = { save: jest.fn(), create: jest.fn(), find: jest.fn() };

  const service = new RagAdminService(
    {} as never,
    documentService as never,
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
    ingest.ingestText.mockResolvedValue({ rag: { docId: 'new' }, obsidian: {} });

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
    docMetaRepo.findOne.mockResolvedValue({ docId: 'new', userId: 'user-1', reviewStatus: 'approved' });
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
      docId: 'draft', userId: 'user-1', reviewStatus: 'pending_review',
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
