import { createService } from './rag.service.test-utils';

describe('RagService retrieval and answer gates', () => {
  it('returns an answer only when retrieval and citation support pass', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce('LangChain 用于构建 RAG 应用。[片段1]');
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content: 'LangChain builds RAG applications',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const result = await service.answer('LangChain RAG', [], 'user-1');

    expect(result).toMatchObject({
      answer: 'LangChain 用于构建 RAG 应用。[片段1]',
      retrievalSufficient: true,
      retrievalReason: '检索片段和答案引用通过本地质量闸门',
    });
    expect(result.references).toHaveLength(1);
  });

  it('Simple 直答未命中后对精确查询也执行统一混合检索', async () => {
    const {
      service,
      llmInvoke,
      vectorStoreSearchMock: vectorSearch,
    } = createService();
    llmInvoke.mockResolvedValueOnce('活动 ID ACT100 的状态是已上线。[片段1]');
    service.indexChunks(
      [
        {
          id: 'chunk-act100',
          content: '活动 ID ACT100 的状态是已上线。',
          docId: 'activity-doc',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const result = await service.answer(
      '活动 ID ACT100 的状态是什么？',
      [],
      'user-1',
      [],
      undefined,
      { adaptiveVectorSearch: true },
    );

    expect(result.retrievalSufficient).toBe(true);
    expect(vectorSearch).toHaveBeenCalled();
  });

  it('Simple 自适应检索对流程类问题直接使用混合检索', async () => {
    const {
      service,
      llmInvoke,
      vectorStoreSearchMock: vectorSearch,
    } = createService();
    llmInvoke.mockResolvedValueOnce('先创建活动，再配置奖池。[片段1]');
    service.indexChunks(
      [
        {
          id: 'chunk-process',
          content: '配置抽奖活动时，先创建活动，再配置奖池。',
          docId: 'activity-process-doc',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    await service.answer(
      '如何配置抽奖活动流程？',
      [],
      'user-1',
      [],
      undefined,
      { adaptiveVectorSearch: true },
    );

    expect(vectorSearch).toHaveBeenCalledTimes(1);
  });

  it('Simple 关键词证据不足时补查向量库', async () => {
    const {
      service,
      llmInvoke,
      vectorStoreSearchMock: vectorSearch,
      indexService,
    } = createService({
      vectorStoreProvider: {
        similaritySearch: jest.fn().mockResolvedValue([
          {
            id: 'chunk-semantic',
            content: '活动 ID ACT100 的状态是已上线。',
            docId: 'activity-semantic-doc',
            chunkIndex: 0,
            score: 0.98,
          },
        ]),
      },
    });
    llmInvoke.mockResolvedValueOnce('活动 ID ACT100 的状态是已上线。[片段1]');
    service.indexChunks(
      [
        {
          id: 'chunk-semantic',
          content: '活动 ID ACT100 的状态是已上线。',
          docId: 'activity-semantic-doc',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );
    jest.spyOn(indexService, 'searchLocalBm25').mockReturnValue([]);

    const result = await service.answer(
      '活动 ID ACT100 的状态是什么？',
      [],
      'user-1',
      [],
      undefined,
      { adaptiveVectorSearch: true },
    );

    expect(vectorSearch).toHaveBeenCalledTimes(1);
    expect(result.retrievalSufficient).toBe(true);
  });

  it('非结构化片段命中不绕过完整生成链路', async () => {
    const {
      service,
      llmInvoke,
      vectorStoreSearchMock: vectorSearch,
    } = createService();
    llmInvoke.mockResolvedValue('活动 ID ACT100 的状态是已上线。[片段1]');
    service.indexChunks(
      [
        {
          id: 'chunk-governed-direct',
          content: '活动 ID ACT100 的状态是已上线。',
          docId: 'governed-activity-doc',
          chunkIndex: 0,
          lifecycleStatus: 'effective',
          docVersion: '2026.01',
          effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
          sourceAuthority: 'official',
        },
      ],
      'user-1',
    );

    const result = await service.answer(
      '活动 ID ACT100 的状态是什么？',
      [],
      'user-1',
      [],
      undefined,
      { governedDirectAnswer: true },
    );

    expect(result.answer).toContain('活动 ID ACT100 的状态是已上线');
    expect(result.retrievalReason).toContain('检索片段和答案引用通过');
    expect(vectorSearch).toHaveBeenCalledTimes(1);
    expect(llmInvoke).toHaveBeenCalled();
  });

  it('缺少版本元数据的 RAG 知识不能绕过检索与生成门禁', async () => {
    const { service, vectorStoreSearchMock: vectorSearch } = createService();
    service.indexChunks(
      [
        {
          id: 'chunk-missing-version',
          content: '活动 ID ACT101 的状态是已上线。',
          docId: 'missing-version-doc',
          chunkIndex: 0,
          lifecycleStatus: 'effective',
          effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
          sourceAuthority: 'official',
        },
      ],
      'user-1',
    );

    const result = await service.answer(
      '活动 ID ACT101 的状态是什么？',
      [],
      'user-1',
      [],
      undefined,
      { governedDirectAnswer: true },
    );

    expect(result.retrievalReason).not.toContain('受治理 受治理编译知识');
    expect(vectorSearch).toHaveBeenCalledTimes(1);
  });

  it('rejects an LLM answer without citations when no extractive answer can be built', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce('LangChain 用于构建 RAG 应用。');
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content: 'RAG',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const result = await service.answer('LangChain RAG', [], 'user-1');
    expect(result.answer).toContain('回答生成服务未返回');
    expect(result.references).toEqual([]);
    expect(result.retrievalSufficient).toBe(false);
    expect(result.retrievalReason).toContain('已禁止输出原始片段');
  });

  it('uses only current evidence for a cited extractive fallback', () => {
    const { service } = createService();
    const visibleEvidence = [
      {
        id: 'procurement-1',
        content:
          '采购订单 PO 金额超过 100000 元时，必须完成预算审批、法务合同归档和供应商准入检查后才能付款。',
        docId: 'procurement-doc',
        chunkIndex: 0,
        bm25Score: 0.8,
        cosineScore: 0.8,
        totalScore: 0.9,
      },
      {
        id: 'procurement-2',
        content: '付款前必须取得增值税专用发票或财务确认的等效票据。',
        docId: 'procurement-doc',
        chunkIndex: 1,
        bm25Score: 0.7,
        cosineScore: 0.7,
        totalScore: 0.8,
      },
    ];
    const answer = (
      service as unknown as {
        buildCitationSafeExtractiveAnswer: (
          query: string,
          chunks: typeof visibleEvidence,
        ) => string | null;
      }
    ).buildCitationSafeExtractiveAnswer(
      'PO 超过 10 万付款前必须完成哪些动作？',
      visibleEvidence,
    );

    expect(answer).not.toBeNull();
    expect(answer).toContain('预算审批');
    expect(answer).toContain('[片段1]');
    expect(
      (
        service as unknown as {
          assessCitationSupport: (
            value: string,
            chunks: typeof visibleEvidence,
          ) => { sufficient: boolean; reason: string };
        }
      ).assessCitationSupport(answer!, visibleEvidence),
    ).toMatchObject({ sufficient: true });
    expect(
      service
        .selectCitedChunks(answer!, visibleEvidence)
        .map((chunk) => chunk.id),
    ).toContain('procurement-1');
  });

  it('keeps deterministic facts when Agentic requests synthesis', async () => {
    const { service, llmInvoke } = createService();
    const result = await service.generateGroundedAnswer(
      '客户行为日志和财务审计凭证分别保留多久？',
      [
        {
          id: 'retention-1',
          content:
            '章节路径：数据保留与删除制度 > 保留期限\n客户行为日志默认保留 180 天，用于问题排查。财务审计凭证保留 10 年，包含发票和付款审批。',
          docId: 'retention-doc',
          chunkIndex: 0,
          bm25Score: 1,
          cosineScore: 1,
          totalScore: 1,
        },
      ],
      [],
      [],
      undefined,
      { needsSynthesis: true },
    );

    expect(result.answer).toContain('180 天');
    expect(result.answer).toContain('10 年');
    expect(result.retrievalSufficient).toBe(true);
    expect(llmInvoke).not.toHaveBeenCalled();
  });

  it('passes planned answer requirements into the grounded answer prompt', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce('负责人林晓，预算728万元。[片段1]');

    await service.generateGroundedAnswer(
      '请列出项目负责人、预算、交付日期和风险等级。',
      [
        {
          id: 'project-1',
          content:
            '项目负责人：林晓。核准预算：728 万元。正式交付日期：2027 年 3 月 18 日。风险等级：中等。',
          docId: 'project-doc',
          chunkIndex: 0,
          bm25Score: 1,
          cosineScore: 1,
          totalScore: 1,
        },
      ],
      [],
      [],
      undefined,
      {
        answerRequirements: ['负责人和预算', '交付日期和风险等级'],
      },
    );

    const prompt = JSON.stringify(llmInvoke.mock.calls[0]?.[0]);
    expect(prompt).toContain('1. 负责人和预算');
    expect(prompt).toContain('2. 交付日期和风险等级');
  });

  it('extracts the salary date from current evidence instead of a fixed demo value', () => {
    const { service } = createService();
    const answer = service.buildEvidenceFirstAnswer('薪资什么时候发放？', [
      {
        id: 'payroll-current',
        content: '基本工资按月发放，每月 15 日发放。',
        docId: 'payroll-policy',
        chunkIndex: 0,
        bm25Score: 1,
        cosineScore: 1,
        totalScore: 1,
      },
    ]);

    expect(answer).toContain('每月 15 日发放');
    expect(answer).toContain('[片段1]');
    expect(answer).not.toContain('10 日');
  });

  it('does not turn an unrelated payroll schedule into a tax answer', () => {
    const { service } = createService();
    const answer = service.buildEvidenceFirstAnswer('工资需要缴纳哪些税？', [
      {
        id: 'payroll-schedule-only',
        content: '基本工资按月发放，每月 15 日发放。',
        docId: 'payroll-policy',
        chunkIndex: 0,
        bm25Score: 1,
        cosineScore: 1,
        totalScore: 1,
      },
    ]);

    expect(answer).toBeNull();
  });

  it('does not mark a multi-question answer sufficient when one sub-question is missing', () => {
    const { service } = createService();
    const answer = service.buildEvidenceFirstAnswer(
      '工资什么时候发放？工资需要缴纳哪些税？',
      [
        {
          id: 'payroll-schedule-only',
          content: '基本工资按月发放，每月 15 日发放。',
          docId: 'payroll-policy',
          chunkIndex: 0,
          bm25Score: 1,
          cosineScore: 1,
          totalScore: 1,
        },
      ],
    );

    expect(answer).toBeNull();
  });

  it('does not turn a positive schedule sentence into a conditional answer', () => {
    const { service } = createService();
    const answer = service.buildEvidenceFirstAnswer(
      '工资不发放的条件是什么？',
      [
        {
          id: 'payroll-schedule-only',
          content: '基本工资按月发放，每月 15 日发放。',
          docId: 'payroll-policy',
          chunkIndex: 0,
          bm25Score: 1,
          cosineScore: 1,
          totalScore: 1,
        },
      ],
    );

    expect(answer).toBeNull();
  });

  it('repairs a missing citation when the generated claim is supported', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce('引用来源可以降低幻觉风险。');
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content:
            '检索增强生成需要引用来源，因为用户必须核验答案依据，引用来源可以降低幻觉风险。',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const result = await service.answer(
      '检索增强生成为什么需要引用来源？',
      [],
      'user-1',
    );

    expect(result).toMatchObject({
      answer: '引用来源可以降低幻觉风险。[片段1]',
      retrievalSufficient: true,
      retrievalReason: '检索片段和答案引用通过本地质量闸门',
    });
    expect(result.references).toHaveLength(1);
  });

  it('does not expose raw evidence when a later claim is not cited', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce(
      'LangChain 用于构建 RAG 应用。[片段1] 它还能自动处理所有权限审批。',
    );
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content: 'LangChain builds RAG applications',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const result = await service.answer('LangChain RAG', [], 'user-1');

    expect(result.retrievalSufficient).toBe(false);
    expect(result.retrievalReason).toContain('已禁止输出原始片段');
    expect(result.answer).toContain('回答生成服务未返回');
    expect(result.answer).not.toContain('LangChain builds RAG applications');
  });

  it('never exposes a literary chunk as a governed direct answer', async () => {
    const { answerService, retrievalService } = createService();
    const directService = (
      answerService as unknown as {
        directService: {
          tryGovernedDirectAnswer: (
            query: string,
            userId?: string,
            scope?: unknown,
            entities?: string[],
          ) => Promise<unknown>;
        };
      }
    ).directService;
    jest.spyOn(retrievalService, 'retrieveBm25Only').mockResolvedValue([
      {
        id: 'water-margin-1',
        docId: 'water-margin',
        chunkIndex: 1,
        content:
          '行不得一日，正走之间，官道旁边只见走过一条大汉，李逵见那人看他。',
        lifecycleStatus: 'effective',
        sourceAuthority: 'uploaded_document',
        docVersion: 'v1',
      },
    ]);

    const direct = await directService.tryGovernedDirectAnswer(
      '李逵是谁',
      'user-1',
      undefined,
      ['李逵'],
    );

    expect(direct).toBeNull();
  });

  it('accepts multi-claim answers when every claim has support citations', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce(
      'LangChain builds RAG applications。[片段1] RAG 是检索增强生成。[片段1]',
    );
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content: 'LangChain builds RAG applications。RAG 是检索增强生成。',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const result = await service.answer('LangChain RAG 检索生成', [], 'user-1');

    expect(result.retrievalSufficient).toBe(true);
    expect(result.references).toHaveLength(1);
  });

  it('accepts an uncited structural lead-in before cited conclusions', () => {
    const { service } = createService();
    const gate = service.validateAnswerCitationSupport(
      '根据检索证据，可归纳为：\n模块 A 负责处理请求。[片段1]',
      [
        {
          id: 'chunk-1',
          docId: 'doc-1',
          chunkIndex: 0,
          content: '模块 A 负责处理请求。',
          bm25Score: 0,
          cosineScore: 0,
          totalScore: 0,
        },
      ],
    );

    expect(gate).toEqual(expect.objectContaining({ sufficient: true }));
  });

  it('accepts a cited markdown table when every data row is supported', () => {
    const { service } = createService();
    const gate = service.validateAnswerCitationSupport(
      [
        '| 项目属性 | 资料内容',
        '|--------------|------------|',
        '| 项目负责人 | 林晓 [片段1] |',
        '| 核准预算 | 728 万元 [片段1] |',
        '| 正式交付日期 | 2027 年 3 月 18 日 [片段1] |',
        '| 风险等级 | 中等 [片段1] |',
      ].join('\n'),
      [
        {
          id: 'chunk-1',
          docId: 'doc-1',
          chunkIndex: 0,
          content:
            '项目负责人：林晓。核准预算：728 万元。正式交付日期：2027 年 3 月 18 日。风险等级：中等。',
          bm25Score: 0,
          cosineScore: 0,
          totalScore: 0,
        },
      ],
    );

    expect(gate).toEqual(expect.objectContaining({ sufficient: true }));
  });

  it('adds a cited version conflict notice when retrieved chunks contain multiple versions', async () => {
    const { service, llmInvoke } = createService();
    llmInvoke.mockResolvedValueOnce('2026 住宿报销上限是 650 元。[片段1]');
    service.indexChunks(
      [
        {
          id: 'chunk-1',
          content:
            '2025 版差旅制度规定住宿报销上限为 500 元。2026 版差旅制度规定住宿报销上限为 650 元，并且 2026 版优先生效。',
          docId: 'doc-1',
          chunkIndex: 0,
        },
      ],
      'user-1',
    );

    const result = await service.answer(
      '2026 住宿报销上限是多少？',
      [],
      'user-1',
    );

    expect(result.retrievalSufficient).toBe(true);
    expect(result.answer).toContain('2026 版优先生效');
    expect(result.answer).toContain('[片段1]');
  });
});
