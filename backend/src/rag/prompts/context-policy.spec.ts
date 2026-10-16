import {
  buildContextPolicyMessage,
  formatUntrustedHistoryContext,
} from './context-policy';
import {
  isObjectiveKnowledgeIntent,
  queryIntentSchema,
  resolveStandaloneRetrievalQuery,
  shouldClarifyQueryIntent,
} from './query-intent-router';

describe('context policy', () => {
  const intent = (values: Record<string, unknown>) =>
    queryIntentSchema.parse({
      intent: 'general',
      confidence: 0.9,
      action: 'retrieve',
      sourcePolicy: 'local_only',
      ambiguity: { detected: false },
      ...values,
    });

  it('uses the classifier standalone query only for confident follow-ups', () => {
    const followUp = intent({
      intent: 'follow_up',
      contextMode: 'context_follow_up',
      standaloneQuery: 'Atlas 项目的部署方式是什么？',
    });
    expect(resolveStandaloneRetrievalQuery('那它怎么部署？', followUp)).toBe(
      'Atlas 项目的部署方式是什么？',
    );
    expect(
      resolveStandaloneRetrievalQuery('那它怎么部署？', {
        ...followUp,
        confidence: 0.5,
      }),
    ).toBe('那它怎么部署？');
  });

  it('uses the intent result to identify public facts and unclear questions', () => {
    expect(
      isObjectiveKnowledgeIntent(
        intent({ intent: 'objective_fact', queryType: 'public_knowledge' }),
      ),
    ).toBe(true);
    expect(
      shouldClarifyQueryIntent(
        intent({
          ambiguity: {
            detected: true,
            confidence: 0.4,
            senses: ['项目 A', '项目 B'],
          },
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
