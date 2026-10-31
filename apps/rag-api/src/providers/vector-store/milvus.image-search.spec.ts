import { ConfigService } from '@nestjs/config';
import { MilvusVectorStoreProvider } from './milvus.vector-store';

describe('Milvus image search ACL', () => {
  it('filters before ranking and merges top results across bounded document batches', async () => {
    const readFilterDocIds = (filter: string | undefined): string[] => {
      const match = /^doc_id in (\[.*\])$/.exec(filter ?? '');
      return match ? (JSON.parse(match[1]) as string[]) : [];
    };
    const search = jest.fn((request: { filter?: string }) => {
      const docId = readFilterDocIds(request.filter).at(-1);
      return Promise.resolve({
        results: docId
          ? [
              {
                id: `image-${docId}`,
                doc_id: docId,
                user_id: 'owner',
                url: '/image.png',
                score: Number(docId.split('-')[1]),
              },
            ]
          : [],
      });
    });
    const store = new MilvusVectorStoreProvider({
      get: () => undefined,
    } as unknown as ConfigService);
    Object.assign(store, { client: { search } });

    const allowedDocIds = new Set(
      Array.from({ length: 205 }, (_, index) => `doc-${index}`),
    );
    const results = await store.searchImages(
      [1, 0],
      2,
      undefined,
      allowedDocIds,
    );

    expect(search).toHaveBeenCalledTimes(3);
    const allowed = new Set(allowedDocIds);
    for (const [request] of search.mock.calls) {
      const filteredDocIds = readFilterDocIds(request.filter);
      expect(filteredDocIds.length).toBeGreaterThan(0);
      expect(filteredDocIds.length).toBeLessThanOrEqual(100);
      expect(filteredDocIds.every((docId) => allowed.has(docId))).toBe(true);
    }
    expect(results.map((result) => result.docId)).toEqual([
      'doc-204',
      'doc-199',
    ]);
  });
});
