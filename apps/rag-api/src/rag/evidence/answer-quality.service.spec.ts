import { AnswerQualityService } from './answer-quality.service';
import type { RetrievedChunk } from './retrieval.types';

describe('AnswerQualityService retrieval assessment', () => {
  const service = new AnswerQualityService({
    get: jest.fn().mockReturnValue(undefined),
  });

  function chunk(
    id: string,
    content: string,
    overrides: Partial<RetrievedChunk> = {},
  ): RetrievedChunk {
    return {
      id,
      content,
      docId: `doc-${id}`,
      chunkIndex: 0,
      bm25Score: 0.8,
      cosineScore: 0.8,
      totalScore: 0.8,
      ...overrides,
    };
  }

  it('keeps relevance separate from completeness for a multi-part query', () => {
    const result = service.assessRetrievalQuality(
      '比较 9 月和 10 月活动规则，分别说明奖励',
      [
        chunk('september', '9 月活动规则：完成任务奖励 100 枚金币。', {
          rerankScore: 0.98,
        }),
      ],
      'comparison',
      ['9 月活动奖励规则', '10 月活动奖励规则'],
    );

    expect(result).toMatchObject({
      sufficient: false,
      status: 'partial',
      reasonCode: 'missing_aspects',
      missingAspects: ['10 月活动奖励规则'],
    });
    expect(result.coverage).toEqual([
      expect.objectContaining({ covered: true, evidenceIds: ['september'] }),
      expect.objectContaining({ covered: false, evidenceIds: [] }),
    ]);
  });

  it('does not treat an attachment hit as full coverage', () => {
    const result = service.assessRetrievalQuality(
      '预算和负责人分别是什么？',
      [
        chunk('attachment', '该项目预算为 20 万元。', {
          retrievalSource: 'attachment',
        }),
      ],
      'lookup',
      ['项目预算', '项目负责人'],
    );

    expect(result.sufficient).toBe(false);
    expect(result.missingAspects).toContain('项目负责人');
  });

  it('assigns a shared candidate only to the sub-question it supports', () => {
    const result = service.assessRetrievalQuality(
      '项目预算和负责人',
      [chunk('budget', '该项目预算为 20 万元。')],
      'synthesis',
      ['项目预算', '项目负责人'],
    );

    expect(result.coverage?.[0]).toMatchObject({
      covered: true,
      evidenceIds: ['budget'],
    });
    expect(result.coverage?.[1]).toMatchObject({
      covered: false,
      evidenceIds: [],
    });
  });

  it('requires requested numeric time anchors to appear in the evidence', () => {
    const result = service.assessRetrievalQuality(
      '2026 年 10 月活动规则是什么？',
      [chunk('old-month', '2026 年 9 月活动规则：完成任务奖励金币。')],
    );

    expect(result.sufficient).toBe(false);
    expect(result.reason).toContain('10月');
  });

  it('marks overlapping unsuperseded rule versions as unresolved conflicts', () => {
    const result = service.assessRetrievalQuality('活动积分规则', [
      chunk('v1', '活动积分规则：每日最多获得 10 分。', {
        ruleKey: 'activity.points.daily',
        docVersion: 'v1',
        effectiveAt: '2026-01-01T00:00:00.000Z',
        expiredAt: '2027-01-01T00:00:00.000Z',
      }),
      chunk('v2', '活动积分规则：每日最多获得 20 分。', {
        ruleKey: 'activity.points.daily',
        docVersion: 'v2',
        effectiveAt: '2026-06-01T00:00:00.000Z',
        expiredAt: '2027-06-01T00:00:00.000Z',
      }),
    ]);

    expect(result).toMatchObject({
      sufficient: false,
      status: 'partial',
      reasonCode: 'version_conflict',
      conflicts: ['activity.points.daily'],
    });
  });

  it('allows adjacent rule versions with non-overlapping effective periods', () => {
    const result = service.assessRetrievalQuality(
      '2026 年 10 月活动规则',
      [
        chunk('september', '2026 年 9 月活动规则：每日 10 分。', {
          ruleKey: 'activity.points.daily',
          docVersion: 'v1',
          effectiveAt: '2026-09-01T00:00:00.000Z',
          expiredAt: '2026-10-01T00:00:00.000Z',
        }),
        chunk('october', '2026 年 10 月活动规则：每日 20 分。', {
          ruleKey: 'activity.points.daily',
          docVersion: 'v2',
          effectiveAt: '2026-10-01T00:00:00.000Z',
          expiredAt: '2026-11-01T00:00:00.000Z',
        }),
      ],
      'lookup',
      ['2026 年 10 月活动规则'],
    );

    expect(result.sufficient).toBe(true);
    expect(result.conflicts).toEqual([]);
  });
});
