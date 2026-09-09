import {
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

  it('labels retrieved history as untrusted context', () => {
    const text = formatUntrustedHistoryContext([
      { content: 'Q: React是什么\nA: 一种动物', threadId: 't1', score: 0.9 },
    ]);
    expect(text).toContain('非事实依据');
    expect(text).toContain('未经验证');
    expect(buildContextPolicyMessage()).toContain('不能作为客观事实依据');
  });
});
