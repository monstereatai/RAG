import {
  ImageIndexService,
  type ImageVectorStorePort,
} from './image-index.service';
import type {
  ImageSearchHit,
  ImageVectorRecord,
} from '../../providers/vector-store/vector-store-provider.interface';
import type { MultimodalEmbeddingProvider } from '../../providers/multimodal-embedding/multimodal-embedding.provider';

describe('ImageIndexService', () => {
  const rows = new Map<string, ImageVectorRecord>();
  const insertedBatches: ImageVectorRecord[][] = [];
  const searched: Array<{
    limit: number;
    userId?: string;
    allowedDocIds?: ReadonlySet<string>;
  }> = [];
  const embedding = {
    isEnabled: jest.fn(() => true),
    embedImage: jest.fn(() => Promise.resolve([1, 0])),
    embedText: jest.fn(() => Promise.resolve([1, 0])),
  } as unknown as MultimodalEmbeddingProvider;
  const vectorStore: ImageVectorStorePort = {
    insertImages: jest.fn((records) => {
      insertedBatches.push(records);
      for (const record of records) rows.set(record.id, record);
      return Promise.resolve();
    }),
    countImagesByDocId: jest.fn((docId, userId) =>
      Promise.resolve(
        [...rows.values()].filter(
          (record) =>
            record.docId === docId &&
            (userId === undefined || record.userId === userId),
        ).length,
      ),
    ),
    searchImages: jest.fn((_vector, limit, userId, allowedDocIds) => {
      searched.push({ limit, userId, allowedDocIds });
      const hits: ImageSearchHit[] = [...rows.values()]
        .filter(
          (record) =>
            (!userId || record.userId === userId) &&
            (!allowedDocIds || allowedDocIds.has(record.docId)),
        )
        .map((record) => ({
          id: record.id,
          docId: record.docId,
          userId: record.userId ?? '',
          url: record.url,
          meta: record.meta,
          score: record.docId === 'doc-secret' ? 0.99 : 0.8,
        }));
      return Promise.resolve(
        hits.sort((left, right) => right.score - left.score).slice(0, limit),
      );
    }),
    deleteImagesByDocId: jest.fn((docId, userId) => {
      for (const [id, record] of rows) {
        if (record.docId === docId && (!userId || record.userId === userId)) {
          rows.delete(id);
        }
      }
      return Promise.resolve();
    }),
  };
  const service = new ImageIndexService(embedding, vectorStore);

  beforeEach(() => {
    rows.clear();
    insertedBatches.length = 0;
    searched.length = 0;
    jest.clearAllMocks();
  });

  it('replaces all image assets for one document with stable distinct IDs and one batch write', async () => {
    const assets = [
      {
        docId: 'doc-a',
        userId: 'user-a',
        url: '/assets/page-1.png',
        embeddingBase64: 'data:image/png;base64,chart',
        mimeType: 'image/png',
        assetHash: 'hash-page-1',
        assetKey: 'page-1-1.png',
        meta: { pageNumber: 1, description: '流程图' },
      },
      {
        docId: 'doc-a',
        userId: 'user-a',
        url: '/assets/page-2.png',
        embeddingBase64: 'data:image/png;base64,chart',
        assetHash: 'hash-page-2',
        assetKey: 'page-2-1.png',
        meta: { pageNumber: 2, description: '流程图' },
      },
    ];

    const first = await service.replaceDocumentImages(
      'doc-a',
      'user-a',
      assets,
    );
    const ids = first.map((item) => item.id);
    const second = await service.replaceDocumentImages(
      'doc-a',
      'user-a',
      assets,
    );

    expect(first).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(second.map((item) => item.id)).toEqual(ids);
    expect(embedding.embedImage).toHaveBeenCalledWith({
      url: undefined,
      base64: 'data:image/png;base64,chart',
      mimeType: 'image/png',
    });
    expect(rows.size).toBe(2);
    expect(insertedBatches.at(-1)).toHaveLength(2);
    const metadata = JSON.parse([...rows.values()][0].meta ?? '{}') as Record<
      string,
      unknown
    >;
    expect(metadata['assetHash']).toEqual(expect.any(String));
    expect(metadata['sourceDocId']).toBe('doc-a');

    await service.replaceDocumentImages('doc-a', 'user-a', []);
    expect(rows.size).toBe(0);
  });

  it('pushes document ACL into text vector recall', async () => {
    await service.replaceDocumentImages('doc-secret', 'user-b', [
      {
        docId: 'doc-secret',
        url: '/assets/secret.png',
        assetHash: 'secret-hash',
      },
    ]);
    await service.replaceDocumentImages('doc-allowed', 'user-b', [
      {
        docId: 'doc-allowed',
        url: '/assets/shared.png',
        assetHash: 'shared-hash',
      },
    ]);

    const results = await service.searchText('流程图', {
      topK: 1,
      userId: 'user-a',
      allowedDocIds: new Set(['doc-allowed']),
    });

    expect(searched.at(-1)).toEqual({
      limit: 1,
      userId: undefined,
      allowedDocIds: new Set(['doc-allowed']),
    });
    expect(results.map((item) => item.docId)).toEqual(['doc-allowed']);
    expect(
      await service.searchText('流程图', {
        userId: 'user-a',
        allowedDocIds: new Set(),
      }),
    ).toEqual([]);
  });

  it('embeds an uploaded image and applies the same document ACL filtering', async () => {
    await service.replaceDocumentImages('doc-secret', 'user-b', [
      { docId: 'doc-secret', url: '/assets/secret.png', assetHash: 'secret' },
    ]);
    await service.replaceDocumentImages('doc-allowed', 'user-b', [
      {
        docId: 'doc-allowed',
        url: '/assets/allowed.png',
        assetHash: 'allowed',
      },
    ]);

    const results = await service.searchImage('query-image', 'image/png', {
      topK: 1,
      userId: 'user-a',
      allowedDocIds: new Set(['doc-allowed']),
    });

    expect((embedding.embedImage as jest.Mock).mock.calls).toContainEqual([
      { base64: 'query-image', mimeType: 'image/png' },
    ]);
    expect(searched.at(-1)).toEqual({
      limit: 1,
      userId: undefined,
      allowedDocIds: new Set(['doc-allowed']),
    });
    expect(results.map((item) => item.docId)).toEqual(['doc-allowed']);
  });

  it('recalls an allowed image after more than 50 inaccessible images', async () => {
    for (let index = 0; index < 51; index += 1) {
      await service.replaceDocumentImages(`doc-secret-${index}`, 'user-b', [
        {
          docId: `doc-secret-${index}`,
          url: `/assets/secret-${index}.png`,
        },
      ]);
    }
    await service.replaceDocumentImages('doc-allowed', 'user-a', [
      { docId: 'doc-allowed', url: '/assets/allowed.png' },
    ]);

    const results = await service.searchText('流程图', {
      topK: 1,
      userId: 'user-a',
      allowedDocIds: new Set(['doc-allowed']),
    });

    expect(results.map((item) => item.docId)).toEqual(['doc-allowed']);
  });
});
