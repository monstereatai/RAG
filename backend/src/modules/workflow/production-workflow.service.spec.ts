import { ProductionWorkflowService } from './production-workflow.service';

describe('ProductionWorkflowService', () => {
  const createService = () => {
    const invoke = jest.fn().mockResolvedValue({
      summary: '审查完成',
      deliverables: [
        {
          type: 'review',
          title: '岗位交付物',
          markdown: '## 结论\n\n这是可以直接交接给下一岗位的完整结构化内容。',
        },
      ],
      claims: [
        {
          statement: '当前结论有知识证据支持',
          evidenceIds: ['evidence-1'],
          status: 'supported',
        },
      ],
      issues: [],
      downstreamRisks: [],
      riskLevel: 'low',
      readyForApproval: true,
    });
    const gather = jest.fn().mockResolvedValue({
      evidence: [
        {
          id: 'evidence-1',
          docId: 'doc-1',
          chunkIndex: 0,
          excerpt: '当前有效的项目知识证据。',
          totalScore: 1,
        },
      ],
      executions: [
        {
          tool: 'role_knowledge_search',
          status: 'success',
          durationMs: 1,
          evidenceCount: 1,
        },
      ],
    });
    const createArtifact = jest.fn().mockResolvedValue({
      id: 'artifact-1',
      title: '岗位交付物',
      kind: 'markdown',
      status: 'queued',
    });
    const service = new ProductionWorkflowService(
      {
        getModel: () => ({
          withStructuredOutput: () => ({ invoke }),
        }),
      } as never,
      {
        isEnabled: () => false,
        set: jest.fn(),
        get: jest.fn(),
        zadd: jest.fn(),
        zrange: jest.fn().mockResolvedValue([]),
        expire: jest.fn(),
        setIfAbsent: jest.fn(),
        releaseLock: jest.fn(),
      } as never,
      { gather } as never,
      { create: createArtifact } as never,
    );
    return { service, invoke, gather, createArtifact };
  };

  it('completes a normal task without manual approval', async () => {
    const { service, invoke, gather } = createService();
    const state = await service.start(
      {
        projectId: 'anniversary',
        brief: '游戏官网周年庆活动，需要完成产品到运营的全链路上线审查。',
      },
      'user-1',
    );

    expect(state.status).toBe('completed');
    expect(state.requiresApproval).toBe(false);
    expect(state.approvalMode).toBe('auto');
    expect(invoke).toHaveBeenCalledTimes(6);
    expect(state.executionBatches).toEqual([
      ['product'],
      ['design', 'backend'],
      ['frontend'],
      ['qa'],
      ['operations'],
    ]);
    expect(Object.keys(state.results)).toEqual([
      'product',
      'design',
      'backend',
      'frontend',
      'qa',
      'operations',
    ]);
  });

  it('returns immediately and exposes background progress through status', async () => {
    const { service } = createService();

    const accepted = await service.startAsync(
      {
        projectId: 'async-workflow',
        brief: '验证管理后台启动工作流后立即返回，并通过状态查询取得最终结果。',
        roles: ['product'],
      },
      'user-1',
    );

    expect(accepted.status).toBe('running');
    expect(accepted.threadId).toBeTruthy();

    let state = accepted;
    for (let index = 0; index < 20 && state.status === 'running'; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      state = await service.status(accepted.threadId, 'user-1');
    }
    expect(state.status).toBe('completed');
    expect(state.completedRoles).toEqual(['product']);
  });

  it('supports one role running independently', async () => {
    const { service, invoke } = createService();
    const state = await service.start(
      {
        projectId: 'frontend-review',
        brief: '单独审查游戏官网活动页的前端状态管理、埋点和异常降级方案。',
        roles: ['frontend'],
      },
      'user-1',
    );

    expect(state.status).toBe('completed');
    expect(state.selectedRoles).toEqual(['frontend']);
    expect(Object.keys(state.results)).toEqual(['frontend']);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(state.results.frontend?.generatedArtifact?.id).toBe('artifact-1');
    expect(state.results.frontend?.evidenceCoverage).toBe(1);
  });

  it('rejects generated project code without runnable entry requirements', async () => {
    const { service, invoke } = createService();
    jest.spyOn(service, 'codingContext').mockResolvedValue({
      threadId: 'thread-1',
      projectId: 'demo',
      brief: '生成活动页',
      stages: [],
    } as never);
    invoke.mockResolvedValue({
      projectName: 'demo',
      framework: 'React + Vite',
      runCommand: 'npm run dev',
      notes: [],
      files: [
        {
          path: 'package.json',
          content: '{"scripts":{"dev":"vite","build":"vite build"}}',
          purpose: '配置',
        },
      ],
    });
    await expect(service.generateProject('thread-1', 'user-1')).rejects.toThrow(
      '缺少 package.json、index.html',
    );
  });

  it('finishes with an evidence-preserving deliverable when the model fails', async () => {
    const { service, invoke, createArtifact } = createService();
    invoke.mockRejectedValue(new Error('model unavailable'));

    const state = await service.start(
      {
        projectId: 'degraded-review',
        brief: '单独审查后端方案，并验证模型失败时不会阻塞整个工作流。',
        roles: ['backend'],
      },
      'user-1',
    );

    expect(state.status).toBe('completed');
    expect(state.results.backend?.readyForApproval).toBe(false);
    expect(state.results.backend?.evidenceCoverage).toBe(0);
    expect(state.results.backend?.deliverables[0]?.type).toBe(
      'degraded-review',
    );
    expect(state.results.backend?.claims[0]?.status).toBe(
      'pending_confirmation',
    );
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(createArtifact).toHaveBeenCalledTimes(1);
  });

  it('normalizes multiple roles into production dependency order', async () => {
    const { service } = createService();
    const state = await service.start(
      {
        projectId: 'delivery-review',
        brief: '让产品、后端和测试协作审查活动规则、接口实现和验收覆盖情况。',
        roles: ['qa', 'product', 'backend'],
      },
      'user-1',
    );

    expect(state.status).toBe('completed');
    expect(state.selectedRoles).toEqual(['product', 'backend', 'qa']);
    expect(Object.keys(state.results)).toEqual(['product', 'backend', 'qa']);
  });

  it('advances an important task only after explicit approvals', async () => {
    const { service } = createService();
    let state = await service.start(
      {
        projectId: 'anniversary',
        brief: '游戏官网周年庆活动，需要完成产品到运营的全链路上线审查。',
        approvalMode: 'required',
      },
      'user-1',
    );

    expect(state.currentRole).toBe('product');
    expect(state.status).toBe('pending_approval');
    for (const role of ['design', 'frontend', 'qa', 'operations']) {
      state = await service.resume(
        state.threadId,
        { approval: 'approved' },
        'user-1',
      );
      expect(state.currentRole).toBe(role);
      expect(state.status).toBe('pending_approval');
    }
    state = await service.resume(
      state.threadId,
      { approval: 'approved' },
      'user-1',
    );

    expect(state.status).toBe('completed');
    expect(Object.keys(state.results)).toEqual([
      'product',
      'design',
      'backend',
      'frontend',
      'qa',
      'operations',
    ]);
  });

  it('pauses on rejection and reruns only after an explicit revision action', async () => {
    const { service, invoke, gather } = createService();
    let state = await service.start(
      {
        projectId: 'anniversary',
        brief: '游戏官网周年庆活动，需要审查多地区规则和异常状态。',
        approvalMode: 'required',
      },
      'user-1',
    );
    state = await service.resume(
      state.threadId,
      { approval: 'approved' },
      'user-1',
    );
    expect(state.currentRole).toBe('design');

    state = await service.resume(
      state.threadId,
      {
        approval: 'rejected',
        feedback: '后端缺少发奖补偿说明',
        rerunRoles: ['backend'],
      },
      'user-1',
    );
    expect(state.currentRole).toBe('design');
    expect(state.status).toBe('revision_required');
    expect(state.currentBatch).toEqual(['design', 'backend']);
    expect(state.revisionNumber).toBe(2);
    expect(state.rerunRoles).toEqual(['backend']);
    expect(state.staleRoles).toEqual(['frontend', 'qa', 'operations']);
    expect(invoke).toHaveBeenCalledTimes(3);

    state = await service.revise(
      state.threadId,
      {
        rerunRoles: ['backend'],
        supplementalMaterials:
          '已核验：发奖失败必须进入 compensation_queue，且保留幂等键。',
      },
      'user-1',
    );
    expect(state.status).toBe('pending_approval');
    expect(state.results.backend?.revision).toBe(2);
    expect(state.supplementalMaterials).toContain('compensation_queue');
    expect(state.revisionHistory.at(-1)?.rerunRoles).toEqual(['backend']);
    expect(state.revisionHistory.at(-1)?.supplementalMaterials).toContain(
      'compensation_queue',
    );
    expect(gather.mock.calls.at(-1)?.[1].brief).toContain('compensation_queue');
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it('pauses only when a role meets risk-based approval policy', async () => {
    const { service, invoke } = createService();
    invoke.mockResolvedValueOnce({
      summary: '高风险产品规则',
      deliverables: [
        {
          type: 'prd',
          title: '高风险规则',
          markdown: '## 高风险规则\n\n奖励概率与库存规则需要业务负责人确认。',
        },
      ],
      claims: [],
      issues: ['奖励概率待确认'],
      downstreamRisks: ['错误配置会影响奖励成本'],
      riskLevel: 'high',
      readyForApproval: false,
    });

    const state = await service.start(
      {
        projectId: 'risk-review',
        brief: '审查涉及奖励概率和有限库存的周年庆抽奖规则。',
        roles: ['product', 'design'],
        approvalMode: 'risk_based',
        riskApprovalThreshold: 'high',
      },
      'user-1',
    );

    expect(state.status).toBe('pending_approval');
    expect(state.pendingApprovalRoles).toEqual(['product']);
  });

  it('downgrades claims that reference unknown evidence', async () => {
    const { service, invoke } = createService();
    invoke.mockResolvedValueOnce({
      summary: '证据检查',
      deliverables: [
        {
          type: 'review',
          title: '证据检查',
          markdown: '## 证据检查\n\n没有合法引用的事实必须等待人工确认。',
        },
      ],
      claims: [
        {
          statement: '没有合法证据的结论',
          evidenceIds: ['invented-id'],
          status: 'supported',
        },
      ],
      issues: [],
      downstreamRisks: [],
      riskLevel: 'low',
      readyForApproval: true,
    });

    const state = await service.start(
      {
        projectId: 'evidence-review',
        brief: '检查事实声明是否全部绑定当前检索到的合法知识证据。',
        roles: ['product'],
      },
      'user-1',
    );

    expect(state.results.product?.claims[0]).toEqual({
      statement: '没有合法证据的结论',
      evidenceIds: [],
      status: 'pending_confirmation',
    });
    expect(state.results.product?.evidenceCoverage).toBe(0);
    expect(state.results.product?.readyForApproval).toBe(false);
  });

  it('isolates workflow state by owner', async () => {
    const { service } = createService();
    const state = await service.start(
      {
        projectId: 'anniversary',
        brief: '游戏官网周年庆活动，需要完成完整上线审查流程。',
      },
      'user-1',
    );

    await expect(service.status(state.threadId, 'user-2')).rejects.toThrow(
      'workflow not found',
    );
  });

  it('indexes historical stage results without lowCodeSchemas instead of crashing', async () => {
    const { service } = createService();
    const state = await service.start(
      {
        projectId: 'legacy-review',
        brief:
          '验证历史工作流岗位结果缺少 lowCodeSchemas 字段时，详情刷新工作流索引不会崩溃。',
        roles: ['product'],
      },
      'user-1',
    );

    // 模拟旧版本写入的岗位结果：缺少后期新增的 lowCodeSchemas 字段。
    const completed = state.results.product;
    expect(completed).toBeTruthy();
    const legacyResult: Record<string, unknown> = { ...completed };
    delete legacyResult.lowCodeSchemas;
    const app = (
      service as unknown as {
        app: {
          updateState: (config: unknown, values: unknown) => Promise<unknown>;
        };
      }
    ).app;
    await app.updateState(
      { configurable: { thread_id: `production:${state.threadId}` } },
      { results: { product: legacyResult } },
    );

    const detail = await service.status(state.threadId, 'user-1');
    expect(detail.status).toBe('completed');
    expect(detail.results.product?.lowCodeSchemas).toBeUndefined();

    const workflows = await service.list('user-1');
    const indexed = workflows.find((item) => item.threadId === state.threadId);
    expect(
      (indexed?.results as Record<string, { lowCodeSchemas: unknown[] }>)
        .product.lowCodeSchemas,
    ).toEqual([]);
  });
});
