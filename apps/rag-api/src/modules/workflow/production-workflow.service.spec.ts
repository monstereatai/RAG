import { ProductionWorkflowService } from './production-workflow.service';
import type { ProductionWorkflowStateType } from './production-workflow.state';
import { AgentRunsService } from '../agent-runs/agent-runs.service';

describe('ProductionWorkflowService', () => {
  it('enumerates only active production runs for notification reconciliation', async () => {
    const repo = { find: jest.fn().mockResolvedValue([{ id: 'run-1' }]) };
    const runs = new AgentRunsService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(runs.listActiveProductionWorkflows()).resolves.toEqual([{ id: 'run-1' }]);
    const options = repo.find.mock.calls[0][0];
    expect(options.where.route).toBe('production_workflow');
    expect(options.where.status.value).toEqual(['running', 'waiting_approval']);
    expect(options.take).toBe(500);
  });
  const createService = (
    workflowQueue?: { enqueue: jest.Mock },
    collaboration?: { publishMessage: jest.Mock },
  ) => {
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
    const gatherInputs: Array<{
      role: string;
      input: Record<string, unknown>;
    }> = [];
    const gather = jest.fn((role: string, input: Record<string, unknown>) => {
      gatherInputs.push({ role, input });
      return Promise.resolve({
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
        getActiveProviderName: () => undefined,
        getFallbackProviderName: () => undefined,
        runWithSignal: (
          _signal: AbortSignal | undefined,
          callback: () => Promise<unknown>,
        ) => callback(),
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
      {
        create: createArtifact,
        markReviewState: jest.fn().mockResolvedValue({}),
      } as never,
      undefined,
      collaboration as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      workflowQueue as never,
    );
    return { service, invoke, gather, gatherInputs, createArtifact };
  };

  it('completes a normal task without manual approval', async () => {
    const { service, invoke } = createService();
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
      ['design'],
      ['backend'],
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

  it('blocks downstream roles when the model fails under auto approval', async () => {
    const { service, invoke, createArtifact } = createService();
    invoke.mockRejectedValue(new Error('model unavailable'));

    const state = await service.start(
      {
        projectId: 'quality-failure',
        brief: '验证模型连续失败后工作流停在当前岗位。',
        roles: ['product', 'backend'],
      },
      'user-1',
    );

    expect(state.status).toBe('revision_required');
    expect(state.requiresRevision).toBe(true);
    expect(state.rerunRoles).toEqual(['product']);
    expect(state.results.product?.reviewStatus).toBe('pending');
    expect(state.error).toContain('model unavailable');
    expect(state.results.backend).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(createArtifact).toHaveBeenCalledTimes(1);
  });

  it('blocks a result with insufficient evidence before applying auto approval', async () => {
    const { service, invoke } = createService();
    invoke.mockResolvedValue({
      summary: '证据不足',
      deliverables: [{ type: 'review', title: '草稿', markdown: '待核实' }],
      claims: [{ statement: '未经支持的结论', evidenceIds: [], status: 'pending_confirmation' }],
      issues: ['请补充项目证据'],
      downstreamRisks: [],
      riskLevel: 'medium',
      readyForApproval: false,
    });

    const state = await service.start(
      {
        projectId: 'evidence-gap',
        brief: '验证证据不足时下游不启动。',
        roles: ['product', 'backend'],
      },
      'user-1',
    );

    expect(state.status).toBe('revision_required');
    expect(state.results.product?.reviewStatus).toBe('pending');
    expect(state.results.backend).toBeUndefined();
    expect(state.error).toContain('请补充项目证据');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does not retry a model permission error', async () => {
    const { service, invoke } = createService();
    invoke.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));

    await expect(
      service.start(
        { projectId: 'permission-error', brief: '验证权限错误不重试。', roles: ['product'] },
        'user-1',
      ),
    ).rejects.toThrow('forbidden');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('repairs one stable approval notification intent from a saved checkpoint', async () => {
    const { service } = createService();
    const dto = {
      projectId: 'approval-intent',
      brief: '验证审批检查点已保存而通知意图尚未保存时恢复。',
      roles: ['product'] as Array<'product'>,
      approvalMode: 'required' as const,
    };
    const pending = await service.start(dto, 'user-1');
    expect(pending.status).toBe('pending_approval');
    const emit = jest.fn().mockResolvedValue(undefined);
    const context = (service as unknown as { context: { domainEvents: unknown; control: { reconcileApprovalNotifications: () => Promise<void> }; agentRuns: unknown } }).context;
    context.domainEvents = { emit };
    context.agentRuns = {
      listActiveProductionWorkflows: jest.fn().mockResolvedValue([{ threadId: pending.threadId }]),
    };

    await service.start({ ...dto, threadId: pending.threadId }, 'user-1');
    await context.control.reconcileApprovalNotifications();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0][0].idempotencyKey).toBe(
      emit.mock.calls[1][0].idempotencyKey,
    );
  });

  it('does not retry the model when a downstream handoff write fails', async () => {
    const collaboration = {
      publishMessage: jest
        .fn()
        .mockRejectedValue(new Error('handoff unavailable')),
    };
    const { service, invoke } = createService(undefined, collaboration);

    await expect(
      service.start(
        {
          projectId: 'handoff-failure',
          brief: '验证交接消息写入失败时，不再重新生成同一个岗位的模型结果。',
          roles: ['product', 'backend'],
        },
        'user-1',
      ),
    ).rejects.toThrow('handoff unavailable');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('resumes a failed role write from its generated checkpoint', async () => {
    const collaboration = {
      publishMessage: jest
        .fn()
        .mockRejectedValueOnce(new Error('handoff unavailable'))
        .mockResolvedValue(undefined),
    };
    const { service, invoke } = createService(undefined, collaboration);
    const dto = {
      threadId: 'role-write-recovery',
      projectId: 'role-write-recovery',
      brief: '验证岗位交接写入失败后，从已生成的结果继续，不再重复调用模型。',
      roles: ['product', 'backend'] as Array<'product' | 'backend'>,
    };

    await expect(service.start(dto, 'user-1')).rejects.toThrow(
      'handoff unavailable',
    );
    const resumed = await service.start(dto, 'user-1');

    expect(resumed.status).toBe('completed');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(collaboration.publishMessage).toHaveBeenCalledTimes(2);
  });

  it('keeps the legacy executeBatch path for an existing workflow checkpoint', async () => {
    const { service, invoke } = createService();
    const legacy = (
      service as unknown as {
        context: {
          state: {
            createInitialState: (
              dto: {
                projectId: string;
                brief: string;
                roles: Array<'product'>;
              },
              userId: string,
              threadId: string,
            ) => Promise<ProductionWorkflowStateType>;
            runUntilSettled: (
              threadId: string,
              state: ProductionWorkflowStateType,
              input: ProductionWorkflowStateType,
            ) => Promise<ProductionWorkflowStateType>;
          };
        };
      }
    ).context.state;
    const state = await legacy.createInitialState(
      {
        projectId: 'legacy-workflow',
        brief: '验证旧版工作流检查点仍然可以走 executeBatch 节点完成。',
        roles: ['product'],
      },
      'user-1',
      'legacy-thread',
    );
    state.workflowVersion = 1;

    const settled = await legacy.runUntilSettled('legacy-thread', state, state);

    expect(settled.status).toBe('completed');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does not regenerate completed roles in a partially persisted batch', async () => {
    let failed = false;
    const collaboration = {
      publishMessage: jest.fn((input: { fromRole: string }) => {
        if (input.fromRole === 'backend' && !failed) {
          failed = true;
          return Promise.reject(new Error('backend handoff unavailable'));
        }
        return Promise.resolve();
      }),
    };
    const { service, invoke } = createService(undefined, collaboration);
    const dto = {
      threadId: 'partial-batch-recovery',
      projectId: 'partial-batch-recovery',
      brief:
        '验证同批次已有岗位完成时，后续岗位写入失败不会让前序岗位重新生成。',
      roles: ['product', 'design', 'backend', 'frontend'] as Array<
        'product' | 'design' | 'backend' | 'frontend'
      >,
    };

    await expect(service.start(dto, 'user-1')).rejects.toThrow(
      'backend handoff unavailable',
    );
    const resumed = await service.start(dto, 'user-1');

    expect(resumed.status).toBe('completed');
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it('exports one verified handoff manifest for ZIP, page and MCP consumers', async () => {
    const { service } = createService();
    const state = await service.start(
      {
        projectId: 'handoff-workflow',
        brief: '验证导出的 Markdown、Schema 和 RAG 证据来自同一份交接契约。',
        roles: ['product'],
      },
      'user-1',
    );

    const handoff = await service.handoffManifest(state.threadId, 'user-1');

    expect(handoff).toMatchObject({
      formatVersion: 1,
      threadId: state.threadId,
      projectId: 'handoff-workflow',
    });
    expect(handoff.markdown).toContain('# handoff-workflow 产研运交接包');
    expect(handoff.contentHash).toHaveLength(64);
    expect(handoff.manifest.stages[0]).toMatchObject({
      role: 'product',
      reviewStatus: 'approved',
    });
    expect(handoff.schemas).toEqual(expect.any(Array));
    expect(handoff.citations).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'product' })]),
    );
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

  it('enqueues asynchronous workflow starts to the durable queue when available', async () => {
    let enqueuedInput: unknown;
    const workflowQueue = {
      enqueue: jest.fn((input: unknown) => {
        enqueuedInput = input;
        return Promise.resolve(true);
      }),
    };
    const { service, invoke } = createService(workflowQueue);

    const accepted = await service.startAsync(
      {
        projectId: 'queued-workflow',
        brief: '验证异步工作流写入持久队列，而不是只依赖当前进程。',
        roles: ['product'],
      },
      'user-1',
      'tenant-a',
    );

    expect(accepted.status).toBe('running');
    expect(workflowQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(accepted.tenantId).toBe('tenant-a');
    if (
      !enqueuedInput ||
      typeof enqueuedInput !== 'object' ||
      !('id' in enqueuedInput) ||
      typeof enqueuedInput.id !== 'string' ||
      !('operation' in enqueuedInput) ||
      !('threadId' in enqueuedInput) ||
      !('userId' in enqueuedInput) ||
      !('tenantId' in enqueuedInput)
    ) {
      throw new Error('Expected a durable workflow queue job ID.');
    }
    expect(enqueuedInput.operation).toBe('start');
    expect(enqueuedInput.threadId).toBe(accepted.threadId);
    expect(enqueuedInput.userId).toBe('user-1');
    expect(enqueuedInput.tenantId).toBe('tenant-a');
    expect(enqueuedInput.id).toMatch(
      /^production-workflow-start-[a-f0-9]{32}$/,
    );
    expect(enqueuedInput.id).not.toContain(':');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing workflow when tenant or owner does not match', async () => {
    const { service } = createService();
    const state = await service.start(
      {
        projectId: 'tenant-isolation',
        brief: '验证带租户的工作流不能被其他租户复用同一个 threadId。',
        roles: ['product'],
        threadId: 'shared-thread-id',
      },
      'user-1',
      'tenant-a',
    );

    await expect(
      service.start(
        {
          projectId: 'attacker-project',
          brief: '不能覆盖已有工作流。',
          roles: ['product'],
          threadId: state.threadId,
        },
        'user-1',
        'tenant-b',
      ),
    ).rejects.toThrow('workflow not found');

    await expect(
      service.startAsync(
        {
          projectId: 'attacker-project',
          brief: '异步入口也不能覆盖已有工作流。',
          roles: ['product'],
          threadId: state.threadId,
        },
        'user-1',
        'tenant-b',
      ),
    ).rejects.toThrow('workflow not found');

    await expect(
      service.status(state.threadId, 'user-1', 'tenant-b'),
    ).rejects.toThrow('workflow not found');
  });

  it('keeps workflow runtime and domain events in the workflow tenant', async () => {
    const runtimeEvents = { emit: jest.fn().mockResolvedValue(undefined) };
    const domainEvents = { emit: jest.fn().mockResolvedValue(undefined) };
    const { service } = createService();
    type EventState = Pick<
      ProductionWorkflowStateType,
      'tenantId' | 'threadId' | 'runId' | 'projectId'
    >;
    const internals = (
      service as unknown as {
        context: {
          runtimeEvents: { emit: jest.Mock };
          domainEvents: { emit: jest.Mock };
          events: {
            emitRuntimeEvent(
              state: EventState,
              eventType: string,
              actor: string,
              payload: unknown,
            ): Promise<void>;
            emitDomainEvent(
              eventType: string,
              state: EventState,
              payload: Record<string, unknown>,
            ): Promise<void>;
          };
        };
      }
    ).context;
    internals.runtimeEvents = runtimeEvents;
    internals.domainEvents = domainEvents;
    const state = {
      tenantId: 'tenant-a',
      threadId: 'thread-a',
      runId: 'run-a',
      projectId: 'project-a',
    };

    await internals.events.emitRuntimeEvent(state, 'run.started', 'workflow', {
      source: 'test',
    });
    await internals.events.emitDomainEvent('workflow.started', state, {
      source: 'test',
    });

    expect(runtimeEvents.emit).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
    );
    expect(domainEvents.emit).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
    );
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
    const context = (
      service as unknown as {
        context: {
          query: { codingContext: ProductionWorkflowService['codingContext'] };
        };
      }
    ).context;
    jest.spyOn(context.query, 'codingContext').mockResolvedValue({
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

  it('holds an evidence-preserving deliverable for revision when the model fails', async () => {
    const { service, invoke, createArtifact } = createService();
    invoke.mockRejectedValue(new Error('model unavailable'));

    const state = await service.start(
      {
        projectId: 'degraded-review',
        brief: '单独审查后端方案，并验证模型失败时停在当前岗位。',
        roles: ['backend'],
      },
      'user-1',
    );

    expect(state.status).toBe('revision_required');
    expect(state.results.backend?.reviewStatus).toBe('pending');
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

  it('runs independent hierarchical roles concurrently and waits before frontend', async () => {
    const { service, invoke } = createService();
    const output = await invoke();
    invoke.mockClear();
    let active = 0;
    let maxActive = 0;
    invoke.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 40));
      active -= 1;
      return output;
    });

    const state = await service.start(
      {
        projectId: 'parallel-plan',
        brief: '验证设计和后端同层执行，前端等待两者完成。',
        roles: ['product', 'design', 'backend', 'frontend'],
        processType: 'hierarchical',
      },
      'user-1',
    );

    expect(state.status).toBe('completed');
    expect(state.executionBatches).toEqual([
      ['product'],
      ['design', 'backend'],
      ['frontend'],
    ]);
    expect(maxActive).toBe(2);
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it('reuses the successful sibling when one hierarchical role needs revision', async () => {
    const { service, invoke } = createService();
    const output = await invoke();
    invoke.mockClear();
    let calls = 0;
    invoke.mockImplementation(async () => {
      calls += 1;
      if (calls === 3 || calls === 4) throw new Error('backend model unavailable');
      return output;
    });
    const dto = {
      projectId: 'parallel-recovery',
      brief: '验证同层一成一败后只重试失败岗位。',
      roles: ['product', 'design', 'backend', 'frontend'] as Array<'product' | 'design' | 'backend' | 'frontend'>,
      processType: 'hierarchical' as const,
    };
    const blocked = await service.start(dto, 'user-1');
    expect(blocked.status).toBe('revision_required');
    expect(blocked.rerunRoles).toHaveLength(1);
    const sibling = blocked.rerunRoles[0] === 'design' ? 'backend' : 'design';
    expect(blocked.results[sibling]?.reviewStatus).toBe('pending');
    expect(blocked.results.frontend).toBeUndefined();

    const revised = await service.revise(
      blocked.threadId,
      { rerunRoles: blocked.rerunRoles, supplementalMaterials: '模型已恢复。' },
      'user-1',
    );
    expect(revised.status).toBe('completed');
    expect(revised.results[sibling]?.reviewStatus).toBe('approved');
    expect(invoke).toHaveBeenCalledTimes(6);
  });

  it('records comparable sequential and hierarchical mock cost', async () => {
    const measure = async (processType: 'sequential' | 'hierarchical') => {
      const { service, invoke } = createService();
      const output = await invoke();
      invoke.mockClear();
      let estimatedInputTokens = 0;
      invoke.mockImplementation(async (messages: unknown) => {
        estimatedInputTokens += Math.ceil(JSON.stringify(messages).length / 4);
        await new Promise((resolve) => setTimeout(resolve, 40));
        return output;
      });
      const started = Date.now();
      const workflow = await service.start(
        {
          projectId: 'mock-cost',
          brief: '比较同一组岗位的串行和层次执行开销。',
          roles: ['product', 'design', 'backend', 'frontend'],
          processType,
        },
        'user-1',
      );
      expect(workflow.status).toBe('completed');
      return {
        elapsedMs: Date.now() - started,
        modelCalls: invoke.mock.calls.length,
        estimatedInputTokens,
      };
    };

    const sequential = await measure('sequential');
    const hierarchical = await measure('hierarchical');
    expect(sequential.modelCalls).toBe(4);
    expect(hierarchical.modelCalls).toBe(4);
    console.info(JSON.stringify({ benchmark: 'production-workflow-mock', sequential, hierarchical }));
  });

  it('advances an important task only after explicit approvals', async () => {
    const { service } = createService();
    let state = await service.start(
      {
        projectId: 'anniversary',
        brief: '游戏官网周年庆活动，需要完成产品到运营的全链路上线审查。',
        approvalMode: 'required',
        processType: 'hierarchical',
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
    const { service, invoke, gatherInputs } = createService();
    let state = await service.start(
      {
        projectId: 'anniversary',
        brief: '游戏官网周年庆活动，需要审查多地区规则和异常状态。',
        approvalMode: 'required',
        processType: 'hierarchical',
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
    expect(gatherInputs.at(-1)?.input.brief).toContain('compensation_queue');
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
      readyForApproval: true,
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
        context: {
          app: {
            updateState: (config: unknown, values: unknown) => Promise<unknown>;
          };
        };
      }
    ).context.app;
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
