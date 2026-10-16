import { ConfigService } from '@nestjs/config';
import { MilvusVectorStoreProvider } from './milvus.vector-store';

describe('Milvus image search ACL', () => {
  it('filters before ranking and merges top results across bounded document batches', async () => {
    const search = jest.fn(
      (request: { filter?: string; exprValues?: { docIds: string[] } }) =>
        Promise.resolve({
          results: [
            {
              id: `image-${request.exprValues?.docIds.at(-1)}`,
              doc_id: request.exprValues?.docIds.at(-1),
              user_id: 'owner',
              url: '/image.png',
              score: Number(request.exprValues?.docIds.at(-1)?.split('-')[1]),
            },
          ],
        }),
    );
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
    for (const [request] of search.mock.calls) {
      expect(request.filter).toBe('doc_id in {docIds}');
      expect(request.exprValues?.docIds.length).toBeLessThanOrEqual(100);
    }
    expect(results.map((result) => result.docId)).toEqual([
      'doc-204',
      'doc-199',
    ]);
  });
});
