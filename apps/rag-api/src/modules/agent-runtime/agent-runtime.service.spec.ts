import { AgentRuntimeService } from './agent-runtime.service';

describe('AgentRuntimeService', () => {
  const createService = () =>
    new AgentRuntimeService({
      match: jest.fn().mockResolvedValue([{ name: 'rag-research' }]),
    } as never);

  it('creates a bounded agentic plan with selected skills and checkpoint stages', async () => {
    const plan = await createService().createPlan({
      objective: '分析活动方案并生成代码和测试验收清单',
      mode: 'agentic',
    });

    expect(plan.selectedSkills).toEqual(['rag-research']);
    expect(plan.stages.map((stage) => stage.role)).toEqual([
      'planner',
      'researcher',
      'coder',
      'tester',
      'writer',
    ]);
    expect(plan.limits.maxSteps).toBeGreaterThan(0);
    expect(plan.contextPolicy.isolatedByThread).toBe(true);
  });

  it('locates the first failed runtime event instead of only reporting the final error', () => {
    const onset = createService().analyzeFailureOnset([
      { sequence: 1, eventType: 'node.completed', actor: 'agentic' },
      {
        sequence: 2,
        eventType: 'tool.failed',
        actor: 'agentic',
        target: 'bocha_web_search',
        payload: { error: 'timeout' },
      },
      {
        sequence: 3,
        eventType: 'run.failed',
        actor: 'agentic',
        payload: { error: 'upstream failed' },
      },
    ]);

    expect(onset).toMatchObject({
      found: true,
      sequence: 2,
      eventType: 'tool.failed',
      target: 'bocha_web_search',
      recommendation: '检查工具输入、超时、幂等键和降级策略。',
    });
  });
});
