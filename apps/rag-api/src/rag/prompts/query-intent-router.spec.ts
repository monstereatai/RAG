import { QueryPlannerService } from '../planning/query-planner.service';
import { RetrievalPolicyService } from '../planning/retrieval-policy.service';
import { adaptStoredQueryPlan } from '../planning/query-plan';

function createPlanner(invoke: jest.Mock): QueryPlannerService {
  return new QueryPlannerService({
    invoke,
    getActiveProviderName: jest.fn().mockReturnValue('qwen'),
    getFallbackProviderName: jest.fn().mockReturnValue(null),
    getRoutePolicy: jest.fn().mockReturnValue({ maxTokens: 4_096 }),
  } as never);
}

describe('QueryPlannerService', () => {
  it('returns the compact structured plan without permission fields', async () => {
    const invoke = jest.fn().mockResolvedValue(
      JSON.stringify({
        action: 'retrieve',
        domain: 'internal',
        contextMode: 'independent',
        standaloneQuery: '公司的研发流程是什么',
        subQueries: [],
        taskType: 'procedure',
        needsGraph: false,
        entities: [],
        filters: {},
      }),
    );
    const planner = createPlanner(invoke);

    const plan = await planner.plan('公司的研发流程是什么');
    expect(plan).toMatchObject({
      action: 'retrieve',
      domain: 'internal',
      taskType: 'procedure',
    });
    expect(plan).not.toHaveProperty('sourcePolicy');
    expect(plan).not.toHaveProperty('targetKbs');
    expect(plan).not.toHaveProperty('rewriteQueries');
  });

  it('keeps the original query and adds only a contextual follow-up query', async () => {
    let invokedPrompt: string | undefined;
    const invoke = jest.fn((prompt: string) => {
      invokedPrompt = prompt;
      return Promise.resolve(
        JSON.stringify({
          action: 'retrieve',
          domain: 'internal',
          contextMode: 'follow_up',
          standaloneQuery: 'React 吃什么？',
          subQueries: [],
          taskType: 'lookup',
          needsGraph: false,
          entities: ['React'],
          filters: {},
        }),
      );
    });
    const planner = createPlanner(invoke);
    const plan = await planner.plan('那它吃什么？', [
      { role: 'human', content: 'React 是一种动物' },
    ]);
    const execution = new RetrievalPolicyService().build('那它吃什么？', plan);

    expect(execution.queries).toEqual([
      { text: '那它吃什么？', kind: 'original', weight: 1 },
      { text: 'React 吃什么？', kind: 'standalone', weight: 0.85 },
    ]);
    expect(invokedPrompt).toContain('React 是一种动物');
  });

  it('uses a conservative local retrieval fallback on planner failure', async () => {
    const invoke = jest.fn().mockRejectedValue(new Error('provider failed'));
    const planner = createPlanner(invoke);
    const plan = await planner.plan('1+1 等于多少？');
    const execution = new RetrievalPolicyService().build(
      '1+1 等于多少？',
      plan,
    );

    expect(plan).toMatchObject({
      action: 'retrieve',
      domain: 'internal',
      standaloneQuery: '1+1 等于多少？',
    });
    expect(execution.sourcePolicy).toBe('local_only');
  });

  it('derives multi-intent from subQueries and caps them at three', async () => {
    const invoke = jest.fn().mockResolvedValue(
      JSON.stringify({
        action: 'retrieve',
        domain: 'public',
        contextMode: 'independent',
        standaloneQuery: '比较四种方案',
        subQueries: ['方案 A', '方案 B', '方案 C', '方案 D'],
        taskType: 'comparison',
        needsGraph: false,
        entities: [],
        filters: {},
      }),
    );
    const planner = createPlanner(invoke);
    const plan = await planner.plan('比较四种方案');
    expect(plan.subQueries).toEqual(['方案 A', '方案 B', '方案 C']);
  });

  it('adapts legacy mixed plans before the new schema can apply defaults', () => {
    const plan = adaptStoredQueryPlan(
      {
        intent: 'knowledge_qa',
        queryType: 'multi_intent',
        contextMode: 'mixed',
        standaloneQuery: '比较两个方案',
        subQueries: ['方案 A', '方案 B'],
        needsSynthesis: true,
        requiresGraph: true,
        entities: [],
        filters: {},
      },
      '比较一下',
      1,
    );

    expect(plan).toMatchObject({
      contextMode: 'mixed',
      taskType: 'synthesis',
      needsGraph: true,
      subQueries: ['方案 A', '方案 B'],
    });
  });

  it('forces explicit scopes local and only narrows their existing boundary', () => {
    const execution = new RetrievalPolicyService().build(
      'React 是什么？',
      {
        action: 'direct',
        domain: 'public',
        contextMode: 'independent',
        standaloneQuery: 'React 是什么？',
        subQueries: [],
        taskType: 'lookup',
        needsGraph: false,
        entities: [],
        filters: {
          project: 'model-project',
          documentType: 'policy',
          department: '研发部',
          timeRange: '今年',
        },
      },
      { projectId: 'authorized-project' },
      undefined,
      { forceLocal: true },
    );

    expect(execution).toMatchObject({
      sourcePolicy: 'local_only',
      scopeRestricted: true,
      scope: {
        projectId: 'authorized-project',
      },
    });
    expect(execution.scope).not.toHaveProperty('projectId', 'model-project');
    expect(execution.scope).not.toHaveProperty('department');
    expect(execution.scope).not.toHaveProperty('timeRange');
  });

  it('uses the local QueryPlan fast path for a short simple lookup', async () => {
    const invoke = jest.fn();
    const planner = createPlanner(invoke);

    const plan = await planner.plan('生产系统权限默认有效期是多久？', [], {
      preferLocalFastPath: true,
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(plan).toMatchObject({
      action: 'retrieve',
      domain: 'internal',
      contextMode: 'independent',
      standaloneQuery: '生产系统权限默认有效期是多久？',
      taskType: 'lookup',
    });
  });
});
