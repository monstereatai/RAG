import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { SkillsService } from '../skills/skills.service';
import { RagGatewayService } from './rag-gateway.service';

describe('RagGatewayService', () => {
  const chunk = {
    id: 'chunk-1',
    docId: 'doc-1',
    content: 'NestJS 模块说明',
    chunkIndex: 0,
    totalScore: 0.12,
  };

  function createService(sufficient: boolean, reason: string) {
    const karpathyRagService = {
      retrieve: jest.fn().mockResolvedValue([chunk]),
      retrieveReviewedEvidence: jest.fn().mockResolvedValue([]),
      assessRetrievedChunks: jest.fn().mockReturnValue({ sufficient, reason }),
    };
    const skillsService = {
      match: jest.fn().mockResolvedValue([]),
    };

    return {
      service: new RagGatewayService(
        karpathyRagService as unknown as KarpathyRagService,
        skillsService as unknown as SkillsService,
      ),
      karpathyRagService,
    };
  }

  it('marks low-relevance candidates as insufficient context', async () => {
    const { service, karpathyRagService } = createService(
      false,
      '候选片段与问题缺少有效语义关联',
    );

    const result = await service.search({ query: '韦水春是谁', limit: 5 }, 'user-1');

    expect(karpathyRagService.assessRetrievedChunks).toHaveBeenCalledWith(
      '韦水春是谁',
      [chunk],
    );
    expect(result.status).toBe('insufficient_context');
    expect(result.retrievalSufficient).toBe(false);
    expect(result.retrievalReason).toBe('候选片段与问题缺少有效语义关联');
    expect(result.results).toHaveLength(1);
  });

  it('marks relevant candidates as successful retrieval', async () => {
    const { service } = createService(true, '候选片段通过检索质量门禁');

    const result = await service.search({ query: 'NestJS 模块是什么', limit: 5 }, 'user-1');

    expect(result.status).toBe('ok');
    expect(result.retrievalSufficient).toBe(true);
  });

  it('exposes reviewed correction evidence to search clients', async () => {
    const reviewedChunk = {
      ...chunk,
      id: 'reviewed-bad-case:case-1',
      docId: 'reviewed-bad-case:case-1',
      content: '已审核问题：韦水春是谁\n正确处理标准：韦水春是临床病理工作人员。',
      totalScore: 1,
      sourceAuthority: 'reviewed_bad_case',
    };
    const { service, karpathyRagService } = createService(
      true,
      '命中已审核纠错证据',
    );
    karpathyRagService.retrieveReviewedEvidence.mockResolvedValue([reviewedChunk]);

    const result = await service.search({ query: '韦水春是谁', limit: 5 }, 'user-1');

    expect(result.status).toBe('ok');
    expect(result.results[0]?.sourceAuthority).toBe('reviewed_bad_case');
    expect(result.results[0]?.content).toContain('韦水春');
  });

  it('propagates retrieval assessment into context packages', async () => {
    const { service } = createService(false, '检索证据不足');

    const result = await service.context(
      { task: '韦水春是谁', limit: 5, matchSkill: false },
      'user-1',
    );

    expect(result.status).toBe('insufficient_context');
    expect(result.retrievalSufficient).toBe(false);
    expect(result.retrievalReason).toBe('检索证据不足');
  });
});
