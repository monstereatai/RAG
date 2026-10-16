import {
  QueryIntentRouter,
  requiresKnowledgeRetrieval,
} from './query-intent-router';

describe('QueryIntentRouter', () => {
  it('keeps public arithmetic eligible for direct answering', () => {
    expect(requiresKnowledgeRetrieval('1+1 等于多少')).toBe(false);
  });

  it('uses the classifier context mode for temporary session settings', async () => {
    const router = new QueryIntentRouter({
      invoke: jest.fn().mockResolvedValue(
        JSON.stringify({
          intent: 'objective_fact',
          contextMode: 'conversation_setting',
          confidence: 0.99,
          action: 'retrieve',
          sourcePolicy: 'local_only',
          entities: [],
          standaloneQuery: '1+1等于5',
          ambiguity: { detected: false },
        }),
      ),
    } as never);

    await expect(router.classify('1+1等于5')).resolves.toMatchObject({
      contextMode: 'conversation_setting',
      sourcePolicy: 'local_only',
    });
  });

  it('uses the classifier local-knowledge decision for project questions', async () => {
    const router = new QueryIntentRouter({
      invoke: jest.fn().mockResolvedValue(
        JSON.stringify({
          intent: 'project_knowledge',
          confidence: 0.95,
          action: 'retrieve',
          sourcePolicy: 'local_only',
          queryType: 'project_knowledge',
          targetKbs: ['company', 'project', 'documents'],
          entities: [],
          standaloneQuery: '内部业务链路有哪些',
          ambiguity: { detected: false },
        }),
      ),
    } as never);

    await expect(router.classify('内部业务链路有哪些')).resolves.toMatchObject({
      action: 'retrieve',
      sourcePolicy: 'local_only',
      queryType: 'project_knowledge',
      targetKbs: expect.arrayContaining(['company', 'project', 'documents']),
    });
  });

  it('normalizes a semantic private-entity decision without keyword extraction', async () => {
    const router = new QueryIntentRouter({
      invoke: jest.fn().mockResolvedValue(
        JSON.stringify({
          intent: 'project_knowledge',
          confidence: 0.99,
          action: 'retrieve',
          sourcePolicy: 'local_only',
          queryType: 'private_entity',
          entities: ['李四'],
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

  it('uses the classifier public-knowledge decision for direct answers', async () => {
    const router = new QueryIntentRouter({
      invoke: jest.fn().mockResolvedValue(
        JSON.stringify({
          intent: 'objective_fact',
          confidence: 0.88,
          action: 'direct_answer',
          sourcePolicy: 'direct_answer',
          queryType: 'public_knowledge',
          targetKbs: ['general'],
          entities: [],
          ambiguity: { detected: false },
        }),
      ),
    } as never);

    await expect(router.classify('小红书是什么')).resolves.toMatchObject({
      action: 'direct_answer',
      sourcePolicy: 'direct_answer',
      queryType: 'public_knowledge',
      targetKbs: ['general'],
    });
  });

  it('preserves a structured direct-answer decision for a bare public topic', async () => {
    const router = new QueryIntentRouter({
      invoke: jest.fn().mockResolvedValue(
        JSON.stringify({
          intent: 'general',
          confidence: 0.88,
          action: 'direct_answer',
          sourcePolicy: 'direct_answer',
          queryType: 'public_knowledge',
          targetKbs: ['general'],
          entities: [],
          ambiguity: { detected: false },
        }),
      ),
    } as never);

    await expect(router.classify('小红书')).resolves.toMatchObject({
      action: 'direct_answer',
      sourcePolicy: 'direct_answer',
      queryType: 'public_knowledge',
      targetKbs: ['general'],
    });
  });

  it('keeps project queries local when the classifier identifies project knowledge', async () => {
    const router = new QueryIntentRouter({
      invoke: jest.fn().mockResolvedValue(
        JSON.stringify({
          intent: 'project_knowledge',
          confidence: 0.95,
          action: 'retrieve',
          sourcePolicy: 'local_only',
          queryType: 'project_knowledge',
          needsSynthesis: true,
          targetKbs: ['company', 'project', 'documents'],
          entities: [],
          ambiguity: { detected: false },
        }),
      ),
    } as never);

    await expect(
      router.classify('公司的研发流程是什么'),
    ).resolves.toMatchObject({
      action: 'retrieve',
      sourcePolicy: 'local_only',
      needsSynthesis: true,
      queryType: 'project_knowledge',
      targetKbs: ['company', 'project', 'documents'],
    });
  });

  it('keeps graph probing opt-in to the structured retrieval plan', async () => {
    const router = new QueryIntentRouter({
      invoke: jest.fn().mockResolvedValue(
        JSON.stringify({
          intent: 'project_knowledge',
          confidence: 0.96,
          action: 'retrieve',
          sourcePolicy: 'local_only',
          requiresGraph: true,
          entities: ['活动页', '奖品规则'],
          ambiguity: { detected: false },
        }),
      ),
    } as never);

    await expect(router.classify('活动页和奖品规则之间有什么依赖关系？')).resolves.toMatchObject({
      requiresGraph: true,
      sourcePolicy: 'local_only',
    });
  });

  it('does not retain a hidden keyword router in the legacy helper', () => {
    expect(requiresKnowledgeRetrieval('李四是谁')).toBe(false);
    expect(requiresKnowledgeRetrieval('公司绩效制度是什么')).toBe(false);
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
      sourcePolicy: 'local_only',
      action: 'retrieve',
      multiIntent: false,
      subQueries: [],
    });
  });

  it('does not infer multiIntent from punctuation after classification', async () => {
    const router = new QueryIntentRouter({
      invoke: jest.fn().mockResolvedValue(
        JSON.stringify({
          intent: 'general',
          confidence: 0.9,
          standaloneQuery: 'React 是什么？1+1 等于多少？',
          multiIntent: false,
          ambiguity: { detected: false },
        }),
      ),
    } as never);

    await expect(
      router.classify('React 是什么？1+1 等于多少？'),
    ).resolves.toMatchObject({
      multiIntent: false,
      subQueries: [],
    });
  });

  it('rewrites a follow-up using only the historical entity, never its answer', async () => {
    const invoke = jest.fn().mockResolvedValue(
      JSON.stringify({
        intent: 'follow_up',
        confidence: 0.96,
        action: 'retrieve',
        sourcePolicy: 'local_only',
        standaloneQuery: 'React 吃什么？',
        entities: ['React'],
        rewriteQueries: ['React 吃什么？'],
        historyPolicy: 'context_only',
        ambiguity: { detected: false },
      }),
    );
    const router = new QueryIntentRouter({ invoke } as never);

    await expect(
      router.classify('那它吃什么？', [
        { role: 'human', content: 'React 是一种动物' },
      ]),
    ).resolves.toMatchObject({
      intent: 'follow_up',
      standaloneQuery: 'React 吃什么？',
      historyPolicy: 'context_only',
    });
    expect(invoke.mock.calls[0][0]).toContain('React 是一种动物');
  });

  it('marks explicitly temporary history as hypothesis-only', async () => {
    const router = new QueryIntentRouter({
      invoke: jest.fn().mockResolvedValue(
        JSON.stringify({
          intent: 'follow_up',
          confidence: 0.9,
          action: 'retrieve',
          sourcePolicy: 'local_only',
          standaloneQuery: '小猫吃什么？',
          entities: ['小猫'],
          historyPolicy: 'hypothesis_only',
          ambiguity: { detected: false },
        }),
      ),
    } as never);

    await expect(
      router.classify('那它吃什么？', [
        { role: 'human', content: '假设这只小猫会说话，仅用于本轮推演' },
      ]),
    ).resolves.toMatchObject({ historyPolicy: 'hypothesis_only' });
  });
});
