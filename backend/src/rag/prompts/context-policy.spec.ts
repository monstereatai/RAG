import {
  buildContextualRetrievalQuery,
  buildContextPolicyMessage,
  formatUntrustedHistoryContext,
  isObjectiveFactQuery,
  selectHistoryForQuery,
} from './context-policy';

describe('context policy', () => {
  it('detects objective fact questions', () => {
    expect(isObjectiveFactQuery('1+1等于几')).toBe(true);
    expect(isObjectiveFactQuery('React 是什么')).toBe(true);
    expect(isObjectiveFactQuery('帮我继续写上次的方案')).toBe(false);
  });

  it('removes history from objective fact answers', () => {
    const history = [{ role: 'human' as const, content: '1+1等于5' }];
    expect(selectHistoryForQuery('1+1等于几', history)).toEqual([]);
    expect(selectHistoryForQuery('继续刚才的方案', history)).toEqual(history);
  });

  it('只保留同一实体的最近用户陈述，避免冲突历史同时进入定义问题', () => {
    const history = [
      { role: 'human' as const, content: '小明是一只狗' },
      { role: 'human' as const, content: '小明是一只猫' },
      { role: 'human' as const, content: '小明是一条鱼' },
    ];
    expect(selectHistoryForQuery('小明是什么', history)).toEqual([
      { role: 'human', content: '小明是一条鱼' },
    ]);
    expect(buildContextualRetrievalQuery('小明是什么', history)).toBe(
      '小明是一条鱼\n当前问题：小明是什么',
    );
    expect(buildContextualRetrievalQuery('小白是什么', history)).toBe(
      '小白是什么',
    );
  });

  it('事实核验模式保留冲突历史，但不改变事实证据优先级', () => {
    const history = [
      { role: 'human' as const, content: 'React 是一种动物' },
      { role: 'human' as const, content: 'React 是一个 JavaScript 库' },
    ];
    expect(
      selectHistoryForQuery('React 是什么', history, {
        preserveConflicts: true,
      }),
    ).toEqual(history);
    expect(buildContextPolicyMessage()).toContain('事实证据');
  });

  it('按给定对话验证小明的鸡／南瓜冲突历史', () => {
    const history = [
      { role: 'human' as const, content: '小明是一只鸡' },
      { role: 'human' as const, content: '小明是一个南瓜' },
    ];
    expect(
      selectHistoryForQuery('小明是什么', history, {
        preserveConflicts: true,
      }),
    ).toEqual(history);
    expect(buildContextualRetrievalQuery('小明是什么', history)).toBe(
      '小明是一个南瓜\n当前问题：小明是什么',
    );
  });

  it('labels retrieved history as untrusted context', () => {
    const text = formatUntrustedHistoryContext([
      { content: 'Q: React是什么\nA: 一种动物', threadId: 't1', score: 0.9 },
    ]);
    expect(text).toContain('非事实依据');
    expect(text).toContain('未经验证');
    expect(buildContextPolicyMessage()).toContain('不能作为客观事实依据');
  });
});
