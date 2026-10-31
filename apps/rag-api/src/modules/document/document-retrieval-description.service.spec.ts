import { createHash } from 'node:crypto';
import { DocumentRetrievalDescriptionEntity } from '../../providers/db/entities/document-retrieval-description.entity';
import { DocumentRetrievalDescriptionService } from './document-retrieval-description.service';

describe('DocumentRetrievalDescriptionService', () => {
  function createService() {
    const txDescriptions = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((rows: DocumentRetrievalDescriptionEntity[]) => rows),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const txLinks = {
      delete: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    const manager: {
      transaction: jest.Mock;
      getRepository: jest.Mock;
      delete: jest.Mock;
    } = {
      transaction: jest.fn(),
      getRepository: jest.fn((entity: unknown) =>
        entity === DocumentRetrievalDescriptionEntity
          ? txDescriptions
          : txLinks,
      ),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    manager.transaction.mockImplementation(
      (work: (manager: unknown) => unknown) => Promise.resolve(work(manager)),
    );
    const descriptionRepo = {
      create: jest.fn(
        (row: Partial<DocumentRetrievalDescriptionEntity>) => row,
      ),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      manager,
    };
    const sourceChunkRepo = { find: jest.fn().mockResolvedValue([]) };
    let documentMetaFindOptions: Record<string, unknown> | undefined;
    const documentMetaRepo = {
      find: jest.fn((options: Record<string, unknown>) => {
        documentMetaFindOptions = options;
        return Promise.resolve([]);
      }),
    };
    let documentChunkFindOptions: Record<string, unknown> | undefined;
    const documentChunkRepo = {
      find: jest.fn((options: Record<string, unknown>) => {
        documentChunkFindOptions = options;
        return Promise.resolve([]);
      }),
    };
    const embedding = {
      embedQuery: jest.fn().mockResolvedValue([0.1, 0.2]),
      embedDocuments: jest.fn().mockResolvedValue([[0.1, 0.2]]),
    };
    const vectorStore = {
      upsertDescriptions: jest.fn().mockResolvedValue(undefined),
      searchDescriptions: jest.fn().mockResolvedValue([]),
      listDescriptionIds: jest.fn().mockResolvedValue([]),
      deleteDescriptionsByDocId: jest.fn().mockResolvedValue(undefined),
    };

    const service = new DocumentRetrievalDescriptionService(
      descriptionRepo as never,
      sourceChunkRepo as never,
      documentMetaRepo as never,
      documentChunkRepo as never,
      embedding as never,
      vectorStore as never,
    );
    return {
      service,
      descriptionRepo,
      sourceChunkRepo,
      documentMetaRepo,
      documentChunkRepo,
      getDocumentMetaFindOptions: () =>
        documentMetaFindOptions ?? documentMetaRepo.find.mock.calls.at(-1)?.[0],
      getDocumentChunkFindOptions: () =>
        documentChunkFindOptions ??
        documentChunkRepo.find.mock.calls.at(-1)?.[0],
      embedding,
      vectorStore,
      txDescriptions,
      txLinks,
      manager,
    };
  }

  function seedCurrentDescriptionIndex(
    fixtures: ReturnType<typeof createService>,
    vectorIds: string[],
  ) {
    const metadata = {
      tenantId: 'tenant-1',
      docId: 'doc-1',
      userId: 'user-1',
      filename: 'guide.md',
      summary: '当前摘要',
      docVersion: 'v2',
      indexGeneration: 'generation-2',
      lifecycleStatus: 'effective',
      reviewStatus: 'approved',
      effectiveAt: null,
      expiredAt: null,
    };
    const content = '文档：guide.md\n当前摘要';
    const contentHash = createHash('sha256').update(content).digest('hex');
    const id = createHash('sha256')
      .update(
        [
          'tenant-1',
          'doc-1',
          'v2',
          'generation-2',
          'document_summary',
          contentHash,
        ].join('\0'),
      )
      .digest('hex');
    fixtures.documentMetaRepo.find.mockResolvedValue([metadata]);
    fixtures.documentChunkRepo.find.mockResolvedValue([
      {
        id: 'chunk-1',
        tenantId: 'tenant-1',
        docId: 'doc-1',
        content: '原文证据',
      },
    ]);
    fixtures.descriptionRepo.find.mockResolvedValue([
      {
        id,
        tenantId: 'tenant-1',
        docId: 'doc-1',
        docVersion: 'v2',
        indexGeneration: 'generation-2',
        descriptionType: 'document_summary',
        content,
        contentHash,
      },
    ]);
    fixtures.sourceChunkRepo.find.mockResolvedValue([
      { descriptionId: id, sourceChunkId: 'chunk-1' },
    ]);
    fixtures.vectorStore.listDescriptionIds.mockResolvedValue(vectorIds);
    return { content, id };
  }

  it('builds summary, media and bounded table descriptions with source mappings', () => {
    const { service } = createService();
    const tableRows = Array.from(
      { length: 25 },
      (_, index) => `表格行：名称=条目${index + 1}；状态=有效`,
    );
    const descriptions = service.buildDescriptions(
      {
        tenantId: 'tenant-1',
        docId: 'doc-1',
        filename: 'demo.mp4',
        summary: '视频讲解了表格中的业务规则。',
      },
      [
        {
          id: 'chunk-table',
          tableRef: '业务规则',
          content: ['表格列：名称 / 状态', ...tableRows].join('\n'),
        },
        {
          id: 'chunk-media',
          content:
            '## 画面要点\n![frame](https://example.com/frame.jpg)\n展示产品流程。',
        },
        {
          id: 'chunk-other-table',
          tableRef: '业务规则',
          content: '表格列：地区 / 渠道\n表格行：地区=上海；渠道=线上',
        },
      ],
    );

    const summaries = descriptions.filter(
      (description) => description.descriptionType === 'document_summary',
    );
    const media = descriptions.filter(
      (description) => description.descriptionType === 'video_description',
    );
    const tables = descriptions.filter(
      (description) => description.descriptionType === 'table_group',
    );
    expect(summaries[0].sourceChunkIds).toEqual([
      'chunk-table',
      'chunk-media',
      'chunk-other-table',
    ]);
    expect(media[0].content).toContain('展示产品流程');
    expect(tables).toHaveLength(2);
    expect(tables[0].content).toContain('名称 / 状态');
    expect(tables[0].content).toContain('名称=条目20');
    expect(tables[0].content).not.toContain('名称=条目21');
    expect(tables[1].content).toContain('地区 / 渠道');
    expect(
      tables.every((description) => description.content.length < 8192),
    ).toBe(true);

    const bounded = service.buildDescriptions(
      {
        tenantId: 'tenant-1',
        docId: 'large-doc',
        filename: 'large.png',
        summary: '摘要'.repeat(5_000),
      },
      [
        {
          id: 'large-image-chunk',
          content: `![${'图片描述'.repeat(2_000)}](https://example.com/image.png)`,
        },
      ],
    );
    expect(
      bounded.every(
        (description) =>
          Buffer.byteLength(description.content, 'utf8') <= 8 * 1024,
      ),
    ).toBe(true);
  });

  it('persists replacement descriptions and upserts identical text and mappings to Milvus', async () => {
    const { service, vectorStore, txDescriptions, txLinks } = createService();
    const content = '文档：guide.md\n业务流程摘要';

    const saved = await service.replaceForDocument({
      tenantId: 'tenant-1',
      docId: 'doc-1',
      userId: 'user-1',
      docVersion: 'v2',
      indexGeneration: 'generation-2',
      descriptions: [
        {
          descriptionType: 'document_summary',
          content,
          sourceChunkIds: ['chunk-1', 'chunk-2'],
        },
      ],
    });

    expect(saved).toHaveLength(1);
    expect(txDescriptions.save).toHaveBeenCalledWith(saved);
    expect(txLinks.insert).toHaveBeenCalledWith([
      { descriptionId: saved[0].id, sourceChunkId: 'chunk-1' },
      { descriptionId: saved[0].id, sourceChunkId: 'chunk-2' },
    ]);
    expect(vectorStore.upsertDescriptions).toHaveBeenCalledWith([
      expect.objectContaining({
        id: saved[0].id,
        tenantId: 'tenant-1',
        userId: 'user-1',
        content: saved[0].content,
      }),
    ]);
    expect(saved[0].contentHash).toBe(
      createHash('sha256').update(content).digest('hex'),
    );
  });

  it('returns SQL metadata and source chunk mappings for tenant-scoped vector hits', async () => {
    const { service, vectorStore, descriptionRepo, sourceChunkRepo } =
      createService();
    vectorStore.searchDescriptions.mockResolvedValue([
      {
        id: 'description-1',
        tenantId: 'tenant-1',
        docId: 'doc-1',
        userId: 'owner-1',
        content: 'vector text',
        score: 0.91,
      },
    ]);
    descriptionRepo.find.mockResolvedValue([
      {
        id: 'description-1',
        tenantId: 'tenant-1',
        docId: 'doc-1',
        descriptionType: 'document_summary',
        indexGeneration: 'generation-2',
        docVersion: 'v2',
        content: 'PostgreSQL text',
      },
    ]);
    sourceChunkRepo.find.mockResolvedValue([
      { descriptionId: 'description-1', sourceChunkId: 'chunk-1' },
      { descriptionId: 'description-1', sourceChunkId: 'chunk-2' },
    ]);

    const hits = await service.searchByVector([0.1, 0.2], {
      tenantId: 'tenant-1',
      topK: 5,
    });

    expect(vectorStore.searchDescriptions).toHaveBeenCalledWith([0.1, 0.2], {
      tenantId: 'tenant-1',
      topK: 5,
    });
    expect(hits).toEqual([
      expect.objectContaining({
        id: 'description-1',
        content: 'PostgreSQL text',
        descriptionType: 'document_summary',
        indexGeneration: 'generation-2',
        docVersion: 'v2',
        sourceChunkIds: ['chunk-1', 'chunk-2'],
        score: 0.91,
      }),
    ]);
  });

  it('audits IDs, content and source mappings instead of comparing counts alone', async () => {
    const {
      service,
      vectorStore,
      descriptionRepo,
      sourceChunkRepo,
      documentMetaRepo,
      documentChunkRepo,
    } = createService();
    const metadata = {
      tenantId: 'tenant-1',
      docId: 'doc-1',
      userId: 'user-1',
      filename: 'guide.md',
      summary: '当前摘要',
      docVersion: 'v2',
      indexGeneration: 'generation-2',
      lifecycleStatus: 'expired',
      reviewStatus: 'approved',
      effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
      expiredAt: new Date('2026-06-01T00:00:00.000Z'),
    };
    documentMetaRepo.find.mockResolvedValue([metadata]);
    documentChunkRepo.find.mockResolvedValue([
      {
        id: 'chunk-1',
        tenantId: 'tenant-1',
        docId: 'doc-1',
        content: '原文证据',
      },
    ]);
    const content = '文档：guide.md\n当前摘要';
    const contentHash = createHash('sha256').update(content).digest('hex');
    const expectedId = createHash('sha256')
      .update(
        [
          'tenant-1',
          'doc-1',
          'v2',
          'generation-2',
          'document_summary',
          contentHash,
        ].join('\0'),
      )
      .digest('hex');
    descriptionRepo.find.mockResolvedValue([
      {
        id: expectedId,
        tenantId: 'tenant-1',
        docId: 'doc-1',
        contentHash: 'stale-content-hash',
      },
    ]);
    sourceChunkRepo.find.mockResolvedValue([
      { descriptionId: expectedId, sourceChunkId: 'old-chunk' },
    ]);
    vectorStore.listDescriptionIds.mockResolvedValue(['stale-vector-id']);

    const audit = await service.auditForDocument({
      tenantId: 'tenant-1',
      docId: 'doc-1',
    });

    expect(audit).toEqual({
      documentFound: true,
      docVersion: 'v2',
      indexGeneration: 'generation-2',
      lifecycleStatus: 'expired',
      reviewStatus: 'approved',
      effectiveAt: metadata.effectiveAt,
      expiredAt: metadata.expiredAt,
      expectedCount: 1,
      pgCount: 1,
      milvusCount: 1,
      missingCount: 1,
      staleCount: 1,
      missingPgCount: 0,
      stalePgCount: 0,
      missingMilvusCount: 1,
      staleMilvusCount: 1,
      contentMismatchCount: 1,
      sourceMappingMismatchCount: 1,
    });
  });

  it('rebuilds and audits legacy documents whose tenantId is stored as NULL', async () => {
    const {
      service,
      vectorStore,
      descriptionRepo,
      documentMetaRepo,
      documentChunkRepo,
      getDocumentMetaFindOptions,
      getDocumentChunkFindOptions,
    } = createService();
    documentMetaRepo.find.mockResolvedValue([
      {
        tenantId: null,
        docId: 'legacy-doc',
        userId: 'user-1',
        filename: 'legacy.md',
        summary: '旧资料摘要',
        docVersion: null,
        indexGeneration: null,
        lifecycleStatus: 'effective',
        reviewStatus: 'approved',
        effectiveAt: null,
        expiredAt: null,
      },
    ]);
    documentChunkRepo.find.mockResolvedValue([
      {
        id: 'legacy-chunk',
        tenantId: null,
        docId: 'legacy-doc',
        content: '旧资料原文',
      },
    ]);
    const replace = jest
      .spyOn(service, 'replaceForDocument')
      .mockResolvedValue([]);

    await expect(
      service.rebuild({ tenantId: 'legacy', docId: 'legacy-doc' }),
    ).resolves.toEqual({ documents: 1, descriptions: 0 });
    const rebuildMetaWhere = getDocumentMetaFindOptions()?.where as Array<
      Record<string, unknown>
    >;
    const rebuildChunkWhere = getDocumentChunkFindOptions()?.where as Array<
      Record<string, unknown>
    >;
    expect(rebuildMetaWhere.some((where) => where.tenantId === 'legacy')).toBe(
      true,
    );
    expect(rebuildMetaWhere.some((where) => where.tenantId !== 'legacy')).toBe(
      true,
    );
    expect(rebuildChunkWhere.some((where) => where.tenantId === 'legacy')).toBe(
      true,
    );
    expect(rebuildChunkWhere.some((where) => where.tenantId !== 'legacy')).toBe(
      true,
    );
    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'legacy',
        docId: 'legacy-doc',
        descriptions: [
          expect.objectContaining({
            descriptionType: 'document_summary',
            sourceChunkIds: ['legacy-chunk'],
          }),
        ],
      }),
    );

    vectorStore.listDescriptionIds.mockResolvedValue([]);
    descriptionRepo.find.mockResolvedValue([]);
    const audit = await service.auditForDocument({
      tenantId: 'legacy',
      docId: 'legacy-doc',
    });
    expect(audit.documentFound).toBe(true);
    expect(audit.expectedCount).toBe(1);
    expect(audit.missingPgCount).toBe(1);
    expect(audit.missingMilvusCount).toBe(1);
  });

  it('skips embedding when PostgreSQL mappings and Milvus IDs are already current', async () => {
    const fixtures = createService();
    const { id } = seedCurrentDescriptionIndex(fixtures, []);
    fixtures.vectorStore.listDescriptionIds.mockResolvedValue([id]);

    await expect(
      fixtures.service.rebuild({ tenantId: 'tenant-1', docId: 'doc-1' }),
    ).resolves.toEqual({ documents: 1, descriptions: 0 });

    expect(fixtures.embedding.embedDocuments).not.toHaveBeenCalled();
    expect(
      fixtures.vectorStore.deleteDescriptionsByDocId,
    ).not.toHaveBeenCalled();
    expect(fixtures.vectorStore.upsertDescriptions).not.toHaveBeenCalled();
    expect(fixtures.sourceChunkRepo.find).toHaveBeenCalled();
  });

  it('rebuilds descriptions when their Milvus vector is missing', async () => {
    const fixtures = createService();
    const { content } = seedCurrentDescriptionIndex(fixtures, []);

    await expect(
      fixtures.service.rebuild({ tenantId: 'tenant-1', docId: 'doc-1' }),
    ).resolves.toEqual({ documents: 1, descriptions: 1 });

    expect(fixtures.embedding.embedDocuments).toHaveBeenCalledWith([content]);
    expect(fixtures.vectorStore.deleteDescriptionsByDocId).toHaveBeenCalledWith(
      'tenant-1',
      'doc-1',
    );
    expect(fixtures.vectorStore.upsertDescriptions).toHaveBeenCalledWith([
      expect.objectContaining({ content }),
    ]);
  });

  it('clears old indexes without embedding when a replacement has no descriptions', async () => {
    const fixtures = createService();

    await expect(
      fixtures.service.replaceForDocument({
        tenantId: 'tenant-1',
        docId: 'doc-1',
        descriptions: [],
      }),
    ).resolves.toEqual([]);

    expect(fixtures.embedding.embedDocuments).not.toHaveBeenCalled();
    expect(fixtures.txDescriptions.delete).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      docId: 'doc-1',
    });
    expect(fixtures.vectorStore.deleteDescriptionsByDocId).toHaveBeenCalledWith(
      'tenant-1',
      'doc-1',
    );
    expect(fixtures.vectorStore.upsertDescriptions).toHaveBeenCalledWith([]);
  });

  it('stops document deletion if Milvus description cleanup fails', async () => {
    const { service, vectorStore, descriptionRepo } = createService();
    vectorStore.deleteDescriptionsByDocId.mockRejectedValue(
      new Error('Milvus unavailable'),
    );

    await expect(
      service.deleteForDocument({ tenantId: 'tenant-1', docId: 'doc-1' }),
    ).rejects.toThrow('Milvus unavailable');
    expect(descriptionRepo.find).not.toHaveBeenCalled();
    expect(descriptionRepo.manager.transaction).not.toHaveBeenCalled();
  });
});
