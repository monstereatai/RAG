import {
  appliesToQuery,
  canUseWebFallback,
  createEvidenceBundle,
} from './evidence-bundle';

const chunk = (id: string, totalScore: number) => ({
  id,
  content: `证据 ${id}`,
  docId: 'doc-1',
  chunkIndex: 0,
  bm25Score: 0,
  cosineScore: 0,
  totalScore,
});

describe('EvidenceBundle', () => {
  it('deduplicates evidence and preserves the strongest score', () => {
    const bundle = createEvidenceBundle({
      query: '资料库中李逵是谁',
      chunks: [chunk('same', 0.4), chunk('same', 0.8), chunk('other', 0.6)],
      sourcePolicy: 'local_only',
      assessment: {
        sufficient: true,
        reason: 'semantic pass',
        evaluatedQuery: '资料库中李逵是谁',
      },
    });

    expect(bundle.chunks.map((item) => item.id)).toEqual(['same', 'other']);
    expect(bundle.chunks[0].totalScore).toBe(0.8);
    expect(appliesToQuery(bundle, '资料库中 李逵是谁')).toBe(true);
  });

  it('never permits web fallback for a local-only request', () => {
    const bundle = createEvidenceBundle({
      query: '公司资料中的李四是谁',
      chunks: [],
      sourcePolicy: 'local_only',
      assessment: {
        sufficient: false,
        reason: 'no local evidence',
        evaluatedQuery: '公司资料中的李四是谁',
      },
    });

    expect(canUseWebFallback(bundle)).toBe(false);
  });

  it('permits web fallback only after web-allowed evidence is insufficient', () => {
    const bundle = createEvidenceBundle({
      query: '今天北京天气',
      chunks: [],
      sourcePolicy: 'web_allowed',
      assessment: {
        sufficient: false,
        reason: 'no local evidence',
        evaluatedQuery: '今天北京天气',
      },
    });

    expect(canUseWebFallback(bundle)).toBe(true);
  });
});
