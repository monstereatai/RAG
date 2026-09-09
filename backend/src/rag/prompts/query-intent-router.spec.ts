import {
  QueryIntentRouter,
  requiresKnowledgeRetrieval,
} from './query-intent-router';

describe('QueryIntentRouter', () => {
  it('keeps public arithmetic eligible for direct answering', () => {
    expect(requiresKnowledgeRetrieval('1+1 等于多少')).toBe(false);
  });

  it('normalizes router output into a structured private-entity retrieval decision', async () => {
    const router = new QueryIntentRouter({
      invoke: jest.fn().mockResolvedValue(
        JSON.stringify({
          intent: 'objective_fact',
          confidence: 0.99,
          standaloneQuery: '李四是谁',
          ambiguity: { detected: false },
        }),
      ),
    } as never);

    await expect(router.classify('李四是谁')).resolves.toMatchObject({
      action: 'retrieve',
      queryType: 'private_entity',
      targetKbs: expect.arrayContaining(['documents', 'company']),
      entities: ['李四'],
      rewriteQueries: expect.arrayContaining(['李四是谁']),
    });
  });

  it('forces entity and private-knowledge questions through retrieval', () => {
    expect(requiresKnowledgeRetrieval('李四是谁')).toBe(true);
    expect(requiresKnowledgeRetrieval('公司绩效制度是什么')).toBe(true);
    expect(requiresKnowledgeRetrieval('上次提到的接口怎么改')).toBe(true);
  });

  it('preserves semantic multi-question classification', async () => {
    const router = new QueryIntentRouter({
      invoke: jest.fn().mockResolvedValue(
        JSON.stringify({
          intent: 'general',
          confidence: 0.94,
          standaloneQuery: 'React 是什么？1+1 等于多少？',
          multiIntent: true,
          subQueries: ['React 是什么？', '1+1 等于多少？'],
          ambiguity: { detected: false },
        }),
      ),
    } as never);

    await expect(
      router.classify('React 是什么？1+1 等于多少？'),
    ).resolves.toMatchObject({
      multiIntent: true,
      subQueries: ['React 是什么？', '1+1 等于多少？'],
    });
  });

  it('uses the conservative general route when semantic routing fails', async () => {
    const router = new QueryIntentRouter({
      invoke: jest.fn().mockRejectedValue(new Error('provider failed')),
    } as never);

    await expect(router.classify('1+1 等于多少？')).resolves.toMatchObject({
      intent: 'general',
      confidence: 0,
      multiIntent: false,
      subQueries: [],
    });
  });

  it('preserves explicit question boundaries when the model omits multiIntent', async () => {
    const router = new QueryIntentRouter({
      invoke: jest.fn().mockResolvedValue(
        JSON.stringify({
          intent: 'general',
          confidence: 0.9,
          standaloneQuery: 'React 是什么？1+1 等于多少？',
          ambiguity: { detected: false },
        }),
      ),
    } as never);

    await expect(
      router.classify('React 是什么？1+1 等于多少？'),
    ).resolves.toMatchObject({
      multiIntent: true,
      subQueries: ['React 是什么？', '1+1 等于多少？'],
    });
  });
});
