import { filterSemanticQueries, querySimilarity } from './query-similarity';

describe('query similarity gate', () => {
  it('keeps the original query and rejects drifted rewrites', () => {
    const original = '2026版差旅制度住宿报销上限是多少';
    const result = filterSemanticQueries(original, [
      '2026版差旅制度住宿报销上限是多少？',
      '公司宠物报销标准是什么？',
    ]);
    expect(result).toContain(original);
    expect(result).toHaveLength(2);
  });

  it('returns a normalized cosine score', () => {
    expect(
      querySimilarity('Redis Checkpointer 是什么', 'Redis Checkpointer 是什么'),
    ).toBeCloseTo(1);
    expect(
      querySimilarity('Redis Checkpointer 是什么', '天气怎么样'),
    ).toBeLessThan(0.8);
  });
});
