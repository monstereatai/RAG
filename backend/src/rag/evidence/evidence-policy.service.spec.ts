import type { ConfigService } from '@nestjs/config';
import { EvidencePolicyService } from './evidence-policy.service';
import type { RetrievedChunk } from './retrieval.types';

describe('EvidencePolicyService', () => {
  const policy = new EvidencePolicyService({
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService);

  function chunk(
    id: string,
    totalScore: number,
    rerankScore?: number,
  ): RetrievedChunk {
    return {
      id,
      content: 'NestJS module providers 注入 ConfigService。',
      docId: 'doc-1',
      chunkIndex: 0,
      bm25Score: totalScore,
      cosineScore: totalScore,
      totalScore,
      ...(rerankScore === undefined ? {} : { rerankScore }),
    };
  }

  it('uses one deterministic comparator for reranked and fallback evidence', () => {
    const input = [
      chunk('rrf-high', 0.9),
      chunk('rerank-low', 0.1, 0.8),
      chunk('rrf-tie-b', 0.5),
      chunk('rrf-tie-a', 0.5),
    ];

    expect(policy.rankEvidenceChunks(input).map(({ id }) => id)).toEqual([
      'rerank-low',
      'rrf-high',
      'rrf-tie-a',
      'rrf-tie-b',
    ]);
    expect(input.map(({ id }) => id)).toEqual([
      'rrf-high',
      'rerank-low',
      'rrf-tie-b',
      'rrf-tie-a',
    ]);
  });

  it('keeps the session attachment sufficiency exception in the shared policy', () => {
    expect(
      policy.assessRetrievedChunks('无关问题', [
        { ...chunk('attachment', 0), retrievalSource: 'attachment' },
      ]),
    ).toEqual({
      sufficient: true,
      reason: '当前会话附件命中 1 个片段',
    });
  });

  it('selects only chunks explicitly cited by the answer', () => {
    const chunks = [chunk('first', 0.9), chunk('second', 0.8)];

    expect(policy.selectCitedChunks('结论[片段2]', chunks)).toEqual([
      chunks[1],
    ]);
    expect(policy.selectCitedChunks('没有显式引用', chunks)).toBe(chunks);
  });

  it('builds structured answers from cited evidence through the shared policy', () => {
    expect(
      policy.buildEvidenceFirstAnswer('薪资什么时候发放？', [
        {
          ...chunk('source', 0.9),
          content: '基本工资按月发放，每月 15 日发放。',
        },
      ]),
    ).toBe('基本工资按月发放，每月 15 日发放。[片段1]');
  });
});
