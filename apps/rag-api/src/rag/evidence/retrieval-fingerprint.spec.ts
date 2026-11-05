import type { RetrieveOptions } from '../contracts/rag-types';
import type { RetrievalExecutionPlan } from '../contracts/retrieval-execution-plan';
import { createRetrievalFingerprint } from './retrieval-fingerprint';

describe('createRetrievalFingerprint', () => {
  const executionPlan: RetrievalExecutionPlan = {
    planVersion: 2,
    sourcePolicy: 'local_only',
    queries: [{ text: '预算', kind: 'original', weight: 1 }],
    profile: {
      intent: 'lookup',
      candidateDepth: 20,
      finalTopK: 5,
      neighborWindow: 1,
      sameSectionLimit: 3,
      contextCharacterBudget: 4_000,
      maxChunksPerDocument: 3,
    },
    useGraph: false,
    scope: { projectId: 'alpha' },
    scopeRestricted: true,
    reasonCode: 'internal_evidence_required',
  };

  it('normalizes the query and permission array ordering', () => {
    const left = createRetrievalFingerprint(
      '  项目   预算 ',
      'user-a',
      {
        tenantId: 'tenant-a',
        roles: ['editor', 'owner'],
        departmentIds: ['d2', 'd1'],
      },
      executionPlan,
    );
    const right = createRetrievalFingerprint(
      '项目 预算',
      'user-a',
      {
        tenantId: 'tenant-a',
        roles: ['owner', 'editor'],
        departmentIds: ['d1', 'd2'],
      },
      executionPlan,
    );

    expect(left).toBe(right);
  });

  it('separates user, tenant, scope, policy, and requirement changes', () => {
    const base: RetrieveOptions = {
      tenantId: 'tenant-a',
      roles: ['owner'],
      queryPlan: {
        action: 'retrieve',
        domain: 'internal',
        contextMode: 'independent',
        standaloneQuery: '预算',
        subQueries: [],
        taskType: 'lookup',
        needsGraph: false,
        entities: [],
        filters: {},
      },
    };
    const original = createRetrievalFingerprint(
      '预算',
      'user-a',
      base,
      executionPlan,
    );

    expect(
      createRetrievalFingerprint('预算', 'user-b', base, executionPlan),
    ).not.toBe(original);
    expect(
      createRetrievalFingerprint(
        '预算',
        'user-a',
        { ...base, tenantId: 'tenant-b' },
        executionPlan,
      ),
    ).not.toBe(original);
    expect(
      createRetrievalFingerprint(
        '预算',
        'user-a',
        { ...base, scope: { projectId: 'beta' } },
        { ...executionPlan, scope: { projectId: 'beta' } },
      ),
    ).not.toBe(original);
    expect(
      createRetrievalFingerprint(
        '预算',
        'user-a',
        {
          ...base,
          queryPlan: { ...base.queryPlan!, subQueries: ['预算负责人'] },
        },
        executionPlan,
      ),
    ).not.toBe(original);
  });

  it('uses tenant, user, scope, and plan from RequestContext when top-level fields are absent', () => {
    const requestContext = {
      requestId: 'request-a',
      userId: 'user-a',
      tenantId: 'tenant-a',
      threadId: 'thread-a',
      query: '预算',
      mode: 'auto' as const,
      queryPlan: {
        action: 'retrieve' as const,
        domain: 'internal' as const,
        contextMode: 'independent' as const,
        standaloneQuery: '预算',
        subQueries: [],
        taskType: 'lookup' as const,
        needsGraph: false,
        entities: [],
        filters: {},
      },
      executionPlan,
      sourcePolicy: 'local_only' as const,
      scope: { projectId: 'alpha' },
      deadlineAt: 0,
      budget: {
        maxSteps: 1,
        maxToolCalls: 1,
        remainingSteps: 1,
        remainingToolCalls: 1,
      },
    };
    const options = { requestContext } as RetrieveOptions;
    const original = createRetrievalFingerprint('预算', undefined, options);

    expect(
      createRetrievalFingerprint('预算', undefined, {
        requestContext: {
          ...requestContext,
          userId: 'user-b',
        },
      }),
    ).not.toBe(original);
    expect(
      createRetrievalFingerprint('预算', undefined, {
        requestContext: {
          ...requestContext,
          tenantId: 'tenant-b',
        },
      }),
    ).not.toBe(original);
    expect(
      createRetrievalFingerprint('预算', undefined, {
        requestContext: {
          ...requestContext,
          scope: { projectId: 'beta' },
          executionPlan: { ...executionPlan, scope: { projectId: 'beta' } },
        },
      }),
    ).not.toBe(original);
  });
});
