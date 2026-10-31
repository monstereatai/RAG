import { AgentEvalService } from './agent-eval.service';

describe('AgentEvalService', () => {
  const createService = (judgement: Record<string, unknown>) => {
    const invoke = jest.fn().mockResolvedValue(judgement);
    const model = {
      withStructuredOutput: jest.fn().mockReturnValue({ invoke }),
    };
    const routePolicy = {
      task: 'structured',
      primary: 'qwen',
      fallback: null,
      timeoutMs: 30_000,
      maxTokens: 4_096,
      maxCostUsd: 0.05,
    };
    const llmProvider = {
      getModel: jest.fn().mockReturnValue(model),
      getActiveProviderName: jest.fn().mockReturnValue('qwen'),
      getRoutePolicy: jest.fn().mockReturnValue(routePolicy),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'llm.contextWindowTokens' ? 32_768 : 4_096,
      ),
    };

    return {
      service: new AgentEvalService(llmProvider as never, config as never),
      invoke,
    };
  };

  it('passes an evidence-backed complete test case using explicit judge output', async () => {
    const requiredClaims = ['泰国地区', '泰语长文本', '401'];
    const expectedContextClaims = ['周年庆 V2', '/api/v2/draw', '401'];
    const { service, invoke } = createService({
      answerAssertions: [
        {
          claim: '测试用例中的事实均有上下文支持',
          supported: true,
          reason: '每个事实都能在提供的规则中找到。',
        },
      ],
      coverageAssertions: requiredClaims.map((requirement) => ({
        requirement,
        covered: true,
        reason: '输出已明确覆盖该要求。',
      })),
      contextRecallAssertions: expectedContextClaims.map((expectedClaim) => ({
        expectedClaim,
        present: true,
        reason: '检索上下文包含该证据。',
      })),
      reason: '答案忠实覆盖了标注要求和检索证据。',
    });

    const result = await service.evaluate({
      query: '输出周年庆抽奖接口的异常和地区测试用例',
      contexts: [
        '周年庆 V2 已启用。周年庆 V2 抽奖接口为 /api/v2/draw。未登录用户调用返回 401。泰国地区需要覆盖泰语长文本。',
      ],
      output:
        '前置条件：周年庆 V2 已启用。测试步骤：调用 /api/v2/draw。输入：未登录用户。预期结果：返回 401。边界／异常：泰国地区覆盖泰语长文本。',
      taskType: 'test_case',
      requiredClaims,
      expectedContextClaims,
      useJudge: true,
    });

    expect(result).toMatchObject({
      status: 'evaluated',
      passed: true,
      metrics: {
        faithfulness: 1,
        context_recall: 1,
        requirement_coverage: 1,
        test_case_structure_completeness: 1,
      },
      assertions: {
        missingRequirements: [],
        missingTestCaseSections: [],
      },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('fails unsupported and incomplete output with explicit judge reasons', async () => {
    const requiredClaims = ['欧美地区', '回滚方案'];
    const expectedContextClaims = ['欧美地区', '回滚方案'];
    const { service } = createService({
      answerAssertions: [
        {
          claim: '欧美地区奖励翻倍',
          supported: false,
          reason: '上下文只包含中国大陆地区规则。',
        },
      ],
      coverageAssertions: requiredClaims.map((requirement) => ({
        requirement,
        covered: false,
        reason: '输出没有提供可核验的依据。',
      })),
      contextRecallAssertions: expectedContextClaims.map((expectedClaim) => ({
        expectedClaim,
        present: false,
        reason: '检索上下文缺少该证据。',
      })),
      reason: '答案提出了无证据事实，且遗漏要求。',
    });

    const result = await service.evaluate({
      query: '说明欧美地区活动规则和回滚方案',
      contexts: ['当前资料只记录中国大陆地区活动规则。'],
      output: '欧美地区奖励翻倍，直接上线即可。',
      taskType: 'prd',
      requiredClaims,
      expectedContextClaims,
      useJudge: true,
    });

    expect(result).toMatchObject({
      status: 'evaluated',
      passed: false,
      metrics: {
        faithfulness: 0,
        context_recall: 0,
        requirement_coverage: 0,
      },
      assertions: {
        unsupportedClaims: ['欧美地区奖励翻倍'],
        missingRequirements: requiredClaims,
        missingContextClaims: expectedContextClaims,
      },
    });
  });

  it('does not treat client-supplied tool results as an evaluation without a judge', async () => {
    const { service, invoke } = createService({});
    const result = await service.evaluate({
      query: '生成测试用例',
      contexts: ['活动规则'],
      output: '测试步骤：验证活动规则。',
      taskType: 'test_case',
      expectedSteps: ['检索规则', '生成用例'],
      actualSteps: ['检索规则', '生成用例'],
      toolCalls: [{ name: 'retrieval', success: true }],
    });

    expect(result).toMatchObject({
      status: 'not_evaluated',
      passed: null,
      metrics: {
        faithfulness: null,
        context_recall: null,
        requirement_coverage: null,
      },
      judge: { available: false, skipped: true },
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
