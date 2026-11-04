import {
  buildContextPolicyMessage,
  formatUntrustedHistoryContext,
} from './context-policy';
import {
  isObjectiveKnowledgePlan,
  queryPlanSchema,
  resolveStandaloneRetrievalQuery,
  shouldClarifyQueryPlan,
} from '../planning/query-plan';

describe('context policy', () => {
  const plan = (values: Record<string, unknown>) =>
    queryPlanSchema.parse({
      action: 'retrieve',
      domain: 'internal',
      contextMode: 'independent',
      standaloneQuery: '',
      subQueries: [],
      taskType: 'lookup',
      needsGraph: false,
      entities: [],
      filters: {},
      ...values,
    });

  it('uses the planned standalone query only for follow-ups', () => {
    const followUp = plan({
      contextMode: 'follow_up',
      standaloneQuery: 'Atlas 项目的部署方式是什么？',
    });
    expect(resolveStandaloneRetrievalQuery('那它怎么部署？', followUp)).toBe(
      'Atlas 项目的部署方式是什么？',
    );
    expect(resolveStandaloneRetrievalQuery('那它怎么部署？', plan({}))).toBe(
      '那它怎么部署？',
    );
  });

  it('uses the plan result to identify public facts and unclear questions', () => {
    expect(
      isObjectiveKnowledgePlan(
        plan({ domain: 'public', contextMode: 'verification' }),
      ),
    ).toBe(true);
    expect(
      shouldClarifyQueryPlan(
        plan({ clarificationQuestion: '请补充项目或业务场景' }),
      ),
    ).toBe(false);
    expect(
      shouldClarifyQueryPlan(
        plan({
          action: 'direct',
          clarificationQuestion: '请补充项目或业务场景',
        }),
      ),
    ).toBe(true);
  });

  it('keeps history as untrusted context instead of treating it as evidence', () => {
    expect(buildContextPolicyMessage()).toContain('事实证据');
    const text = formatUntrustedHistoryContext([
      { content: 'Q: React是什么\nA: 一种动物', threadId: 't1', score: 0.9 },
    ]);
    expect(text).toContain('非事实依据');
    expect(text).toContain('未经验证');
    expect(buildContextPolicyMessage()).toContain('不能作为客观事实依据');
  });
});
