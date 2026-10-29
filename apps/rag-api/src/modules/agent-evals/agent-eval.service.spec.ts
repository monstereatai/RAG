import { AgentEvalService } from './agent-eval.service';

describe('AgentEvalService', () => {
  const service = new AgentEvalService({ getModel: jest.fn() } as never);

  it('passes an evidence-backed complete test case', async () => {
    const result = await service.evaluate({
      query: '输出周年庆抽奖接口的异常和地区测试用例',
      contexts: [
        '周年庆 V2 已启用。周年庆 V2 抽奖接口为 /api/v2/draw。未登录用户调用返回 401。泰国地区需要覆盖泰语长文本。',
      ],
      output:
        '前置条件：周年庆 V2 已启用。测试步骤：调用 /api/v2/draw。输入：未登录用户。预期结果：返回 401。边界／异常：泰国地区覆盖泰语长文本。',
      taskType: 'test_case',
      requiredClaims: ['泰国地区', '泰语长文本', '401'],
      expectedContextClaims: ['周年庆 V2', '/api/v2/draw', '401'],
      expectedSteps: ['检索规则', '生成用例'],
      actualSteps: ['检索规则', '生成用例'],
      toolCalls: [
        { name: 'retrieval', success: true },
        { name: 'rerank', success: true },
      ],
      humanHandoff: false,
    });

    expect(result.passed).toBe(true);
    expect(result.metrics.tool_success_rate).toBe(1);
    expect(result.metrics.step_accuracy).toBe(1);
    expect(result.metrics.context_recall).toBe(1);
    expect(result.assertions.missingTestCaseSections).toEqual([]);
  });

  it('fails unsupported and incomplete output with explicit reasons', async () => {
    const result = await service.evaluate({
      query: '说明欧美地区活动规则和回滚方案',
      contexts: ['当前资料只记录中国大陆地区活动规则。'],
      output: '欧美地区奖励翻倍，直接上线即可。',
      taskType: 'prd',
      requiredClaims: ['欧美地区', '回滚方案'],
      expectedContextClaims: ['欧美地区', '回滚方案'],
      expectedSteps: ['检索', '校验', '回答'],
      actualSteps: ['回答'],
      toolCalls: [{ name: 'retrieval', success: false }],
      humanHandoff: true,
    });

    expect(result.passed).toBe(false);
    expect(result.metrics.faithfulness).toBeLessThan(0.88);
    expect(result.metrics.tool_success_rate).toBe(0);
    expect(result.assertions.missingRequirements).toContain('回滚方案');
  });
});
