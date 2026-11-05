import { history } from '@umijs/max';
import { Form, message } from 'antd';
import React from 'react';
import {
  CURRENT_PRODUCTION_WORKFLOW_KEY,
  parseRetrievalConfig,
} from './agent-ops-shared';
import {
  type AgentBadCase,
  type AgentEvalResult,
  type AgenticRunOption,
  type AgenticRunSnapshot,
  type AgentRunSummary,
  cloneGovernanceWorkflow,
  compareGovernanceRetrieval,
  createDecisionRecord,
  debugGovernanceRetrieval,
  delegateAgentTask,
  evaluateAgent,
  getAgentBadCases,
  getAgentRunArtifacts,
  getAgentRunCenter,
  getAgentRunSummary,
  getAgentRuns,
  getAgentTasks,
  getAgentTraces,
  getArtifactDependencies,
  getCollaborationMessages,
  getCollaborationSops,
  getDecisionRecords,
  getGovernanceEvaluationCases,
  getGovernanceModels,
  getGovernancePlugins,
  getGovernanceWorkflows,
  getIntentRoutingSummary,
  getKnowledgeBaseProfiles,
  getProductionWorkflow,
  getProductionWorkflows,
  getRagQualitySummary,
  getRuntimeEventMetrics,
  getRuntimeEvents,
  getSecurityAudit,
  getSecurityPolicies,
  type IntentRoutingSummary,
  type ProductionWorkflow,
  type RagQualitySummary,
  registerGovernancePlugin,
  registerKnowledgeBaseProfile,
  resolveGovernancePluginComposition,
  resumeProductionWorkflow,
  retryAgentRunRecord,
  reviewAgentBadCase,
  setGovernancePluginStatus,
  startProductionWorkflow,
  type TraceSnapshot,
  unwrapData,
} from './service';

export function useAgentOpsController() {
  const pendingStartKey = 'agent-ops:production-workflow:pending-start';
  /**
   * Agent 运营工作台聚合多个独立运行面：工作流、评测、Bad Case、运行轨迹、Artifact 与协作。
   * 它只展示后端状态，不在浏览器端推断审批结果或伪造岗位执行状态。
   */
  const [workflowForm] = Form.useForm();

  const [evalForm] = Form.useForm();

  const [reviewForm] = Form.useForm();

  const [knowledgeBaseForm] = Form.useForm();

  const [pluginForm] = Form.useForm();

  const [decisionForm] = Form.useForm();

  const [delegateForm] = Form.useForm();

  const [workflow, setWorkflow] = React.useState<ProductionWorkflow | null>(
    null,
  );

  const [productionWorkflows, setProductionWorkflows] = React.useState<
    ProductionWorkflow[]
  >([]);

  const [workflowListLoading, setWorkflowListLoading] = React.useState(false);

  const [evalResult, setEvalResult] = React.useState<AgentEvalResult | null>(
    null,
  );

  const [badCases, setBadCases] = React.useState<AgentBadCase[]>([]);

  const [traces, setTraces] = React.useState<TraceSnapshot[]>([]);

  const [runSnapshot, setRunSnapshot] =
    React.useState<AgenticRunSnapshot | null>(null);

  const [runOptions, setRunOptions] = React.useState<AgenticRunOption[]>([]);

  const [runCenter, setRunCenter] = React.useState<any[]>([]);

  const [runSummary, setRunSummary] = React.useState<AgentRunSummary | null>(
    null,
  );

  const [ragQuality, setRagQuality] = React.useState<RagQualitySummary | null>(
    null,
  );

  const [intentRouting, setIntentRouting] =
    React.useState<IntentRoutingSummary | null>(null);

  const [securityPolicies, setSecurityPolicies] = React.useState<
    Array<{ id?: string; name?: string; severity?: string }>
  >([]);

  const [securityAudit, setSecurityAudit] = React.useState<
    Array<{
      id?: string;
      eventType?: string;
      payload?: any;
      createdAt?: string;
    }>
  >([]);

  const [artifactThreadId, setArtifactThreadId] = React.useState('');

  const [artifactLoading, setArtifactLoading] = React.useState(false);

  const [runOptionsLoading, setRunOptionsLoading] = React.useState(false);

  const [selectedBadCase, setSelectedBadCase] =
    React.useState<AgentBadCase | null>(null);

  const [loading, setLoading] = React.useState(false);

  const [governanceModels, setGovernanceModels] = React.useState<any[]>([]);

  const [governancePlugins, setGovernancePlugins] = React.useState<any[]>([]);

  const [governanceWorkflows, setGovernanceWorkflows] = React.useState<any[]>(
    [],
  );

  const [evaluationCases, setEvaluationCases] = React.useState<any[]>([]);

  const [knowledgeBaseProfiles, setKnowledgeBaseProfiles] = React.useState<
    any[]
  >([]);

  const [retrievalQuery, setRetrievalQuery] = React.useState('');

  const [retrievalProfileKey, setRetrievalProfileKey] =
    React.useState('general');

  const [retrievalCompareProfileKey, setRetrievalCompareProfileKey] =
    React.useState('');

  const [retrievalDebugVariants, setRetrievalDebugVariants] =
    React.useState<Array<{ key: string; result: any }> | null>(null);

  const [retrievalDebugLoading, setRetrievalDebugLoading] =
    React.useState(false);

  const [governanceLoading, setGovernanceLoading] = React.useState(false);

  const [pluginPreview, setPluginPreview] = React.useState<any>(null);

  const [collaborationSops, setCollaborationSops] = React.useState<any[]>([]);

  const [collaborationMessages, setCollaborationMessages] = React.useState<
    any[]
  >([]);

  const [artifactDependencies, setArtifactDependencies] = React.useState<any[]>(
    [],
  );

  const [decisionRecords, setDecisionRecords] = React.useState<any[]>([]);

  const [collaborationReplay, setCollaborationReplay] =
    React.useState<any>(null);

  const [collaborationConflicts, setCollaborationConflicts] = React.useState<
    any[]
  >([]);

  const [agentTasks, setAgentTasks] = React.useState<any[]>([]);

  const [collaborationLoading, setCollaborationLoading] = React.useState(false);

  const [runtimeEvents, setRuntimeEvents] = React.useState<any[]>([]);

  const [runtimeMetrics, setRuntimeMetrics] = React.useState<
    Record<string, number>
  >({});

  const [runtimeRunId, setRuntimeRunId] = React.useState<string>();

  /** Bad Case 审核是运营闭环入口；加载失败提示服务状态，不将空数组误作「没有问题」。 */
  const loadBadCases = React.useCallback(async () => {
    try {
      const result = await getAgentBadCases();
      setBadCases(unwrapData<AgentBadCase[]>(result) ?? []);
    } catch {
      message.error('Bad Case 加载失败，请检查登录状态和 Agent Backend 服务');
    }
  }, []);

  const loadTraces = React.useCallback(async () => {
    const result = await getAgentTraces();
    setTraces(unwrapData<TraceSnapshot[]>(result) ?? []);
  }, []);

  const loadRunOptions = React.useCallback(async () => {
    setRunOptionsLoading(true);
    try {
      const result = await getAgentRuns();
      const options = unwrapData<AgenticRunOption[]>(result) ?? [];
      setRunOptions(options);
      if (!artifactThreadId && options[0]) {
        setArtifactThreadId(options[0].threadId);
        const snapshot = await getAgentRunArtifacts(options[0].threadId);
        setRunSnapshot(unwrapData<AgenticRunSnapshot>(snapshot));
      }
    } catch {
      message.error('最近 Agentic 会话加载失败');
    } finally {
      setRunOptionsLoading(false);
    }
  }, [artifactThreadId]);

  const loadRunSummary = React.useCallback(async () => {
    try {
      setRunSummary(unwrapData<AgentRunSummary>(await getAgentRunSummary()));
    } catch {
      message.error('Agent 运行汇总加载失败');
    }
  }, []);

  const loadRagQuality = React.useCallback(async () => {
    try {
      setRagQuality(
        unwrapData<RagQualitySummary>(await getRagQualitySummary()),
      );
    } catch {
      message.error('RAG 质量汇总加载失败');
    }
  }, []);

  const loadIntentRouting = React.useCallback(async () => {
    try {
      setIntentRouting(
        unwrapData<IntentRoutingSummary>(await getIntentRoutingSummary()),
      );
    } catch {
      message.error('意图路由数据加载失败');
    }
  }, []);

  const loadSecurityPolicies = React.useCallback(async () => {
    try {
      const result = unwrapData<{
        policies?: Array<{ id?: string; name?: string; severity?: string }>;
      }>(await getSecurityPolicies());
      setSecurityPolicies(result?.policies ?? []);
    } catch {
      message.error('安全策略加载失败');
    }
  }, []);

  const loadSecurityAudit = React.useCallback(async () => {
    try {
      const result = unwrapData<{
        events?: Array<{
          id?: string;
          eventType?: string;
          payload?: any;
          createdAt?: string;
        }>;
      }>(await getSecurityAudit());
      setSecurityAudit(result?.events ?? []);
    } catch {
      message.error('安全审计事件加载失败');
    }
  }, []);

  const loadRunArtifacts = async () => {
    const threadId = artifactThreadId.trim();
    if (!threadId) {
      message.warning('请输入 Thread ID');
      return;
    }
    setArtifactLoading(true);
    try {
      const result = await getAgentRunArtifacts(threadId);
      setRunSnapshot(unwrapData<AgenticRunSnapshot>(result));
    } catch {
      message.error('Artifact 状态加载失败，请检查服务和 Thread ID');
    } finally {
      setArtifactLoading(false);
    }
  };

  const loadRunCenter = React.useCallback(async () => {
    try {
      const result = await getAgentRunCenter();
      setRunCenter(unwrapData<any[]>(result) ?? []);
    } catch {
      message.error('运行中心加载失败，请检查 Agent Backend 服务');
    }
  }, []);

  const loadProductionWorkflows = React.useCallback(async () => {
    setWorkflowListLoading(true);
    try {
      const result = await getProductionWorkflows();
      setProductionWorkflows(unwrapData<ProductionWorkflow[]>(result) ?? []);
    } catch {
      message.error('产研运工作流列表加载失败');
    } finally {
      setWorkflowListLoading(false);
    }
  }, []);

  const handleRetryRun = async () => {
    if (!runSnapshot?.available) return;
    const latestRun = runCenter.find(
      (run) => run.threadId === runSnapshot.threadId,
    );
    if (
      !latestRun ||
      !['failed', 'cancelled'].includes(latestRun.status) ||
      !['auto', 'agentic'].includes(latestRun.mode) ||
      latestRun.route === 'simple' ||
      latestRun.route === 'production_workflow'
    ) {
      message.error('只有当前会话最新的失败或取消 Agentic 运行可以重跑');
      return;
    }
    setArtifactLoading(true);
    try {
      const response = await retryAgentRunRecord(latestRun.id);
      const result = unwrapData<{ runId?: string; status?: string }>(response);
      if (!result?.runId) throw new Error('服务没有返回新的运行记录');
      message.success(
        result.status === 'waiting_approval'
          ? 'Agentic 重跑已暂停，等待审批'
          : 'Agentic 链路重跑完成',
      );
      await loadRunCenter();
      history.push(`/agent-ops/run-center/${encodeURIComponent(result.runId)}`);
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : 'Agentic 重跑失败',
      );
    } finally {
      setArtifactLoading(false);
    }
  };

  React.useEffect(() => {
    void Promise.all([
      loadBadCases(),
      loadTraces(),
      loadRunOptions(),
      loadRunSummary(),
      loadRagQuality(),
      loadIntentRouting(),
      loadSecurityPolicies(),
      loadSecurityAudit(),
      loadRunCenter(),
      loadProductionWorkflows(),
    ]).catch(() => undefined);
  }, [
    loadBadCases,
    loadIntentRouting,
    loadRunCenter,
    loadRunOptions,
    loadRunSummary,
    loadRagQuality,
    loadSecurityAudit,
    loadSecurityPolicies,
    loadTraces,
    loadProductionWorkflows,
  ]);

  React.useEffect(() => {
    const threadId = window.localStorage.getItem(
      CURRENT_PRODUCTION_WORKFLOW_KEY,
    );
    if (!threadId) return;
    void getProductionWorkflow(threadId)
      .then((result) => {
        const nextWorkflow = unwrapData<ProductionWorkflow>(result);
        if (!nextWorkflow?.threadId) return;
        if (nextWorkflow.status === 'completed') {
          window.localStorage.removeItem(CURRENT_PRODUCTION_WORKFLOW_KEY);
          return;
        }
        setWorkflow(nextWorkflow);
        workflowForm.setFieldsValue({
          projectId: nextWorkflow.projectId,
          rerunRoles: nextWorkflow.pendingApprovalRoles,
        });
      })
      .catch(() => {
        window.localStorage.removeItem(CURRENT_PRODUCTION_WORKFLOW_KEY);
      });
  }, [workflowForm]);

  React.useEffect(() => {
    if (workflow?.status !== 'running') return;
    const timer = window.setTimeout(() => {
      void getProductionWorkflow(workflow.threadId)
        .then((result) => {
          const nextWorkflow = unwrapData<ProductionWorkflow>(result);
          void loadProductionWorkflows();
          if (nextWorkflow.status === 'failed') {
            setWorkflow(nextWorkflow);
            message.error(nextWorkflow.error || '工作流执行失败，请在运行中心查看原因');
            return;
          }
          if (nextWorkflow.status === 'completed') {
            setWorkflow(null);
            workflowForm.resetFields();
            window.localStorage.removeItem(CURRENT_PRODUCTION_WORKFLOW_KEY);
            message.success(
              nextWorkflow.status === 'completed'
                ? '工作流已完成，详情已收起，可从列表重新查看'
                : '工作流已结束，详情已收起，可从列表重新查看',
            );
            return;
          }
          setWorkflow(nextWorkflow);
          workflowForm.setFieldValue(
            'rerunRoles',
            nextWorkflow.pendingApprovalRoles,
          );
        })
        .catch(() => undefined);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [loadProductionWorkflows, workflow, workflowForm]);

  const loadGovernance = React.useCallback(async () => {
    setGovernanceLoading(true);
    try {
      const [models, plugins, workflows, cases, profiles] = await Promise.all([
        getGovernanceModels(),
        getGovernancePlugins(),
        getGovernanceWorkflows(),
        getGovernanceEvaluationCases(),
        getKnowledgeBaseProfiles(),
      ]);
      setGovernanceModels(unwrapData<any[]>(models) ?? []);
      setGovernancePlugins(unwrapData<any[]>(plugins) ?? []);
      setGovernanceWorkflows(unwrapData<any[]>(workflows) ?? []);
      setEvaluationCases(unwrapData<any[]>(cases) ?? []);
      const profileList = unwrapData<any[]>(profiles) ?? [];
      setKnowledgeBaseProfiles(profileList);
      setRetrievalCompareProfileKey(
        (current) =>
          current ||
          profileList.find((profile) => profile.key !== 'general')?.key ||
          '',
      );
    } catch {
      message.error('平台治理数据加载失败，请检查 Agent Backend 服务');
    } finally {
      setGovernanceLoading(false);
    }
  }, []);

  const handleCloneWorkflow = async (record: any) => {
    const key = window.prompt('请输入副本 Key', `${record.key}-copy`);
    if (!key?.trim()) return;
    try {
      await cloneGovernanceWorkflow(record.id, {
        key: key.trim(),
        name: `${record.name}（副本）`,
      });
      message.success('工作流副本已创建');
      await loadGovernance();
    } catch {
      message.error('工作流复制失败，请检查 Key 是否重复');
    }
  };

  const handleRegisterKnowledgeBase = async () => {
    const values = await knowledgeBaseForm.validateFields();
    setGovernanceLoading(true);
    try {
      await registerKnowledgeBaseProfile(values);
      message.success('知识库配置已保存，后续入库和问答会按配置生效');
      knowledgeBaseForm.resetFields();
      await loadGovernance();
    } finally {
      setGovernanceLoading(false);
    }
  };

  const handleCloneKnowledgeBaseProfile = async (record: any) => {
    const key = window.prompt('请输入调优配置的新 Key', `${record.key}-v2`);
    if (!key?.trim()) return;
    const values = {
      key: key.trim(),
      name: `${record.name}（调优版）`,
      workspaceId: record.workspaceId,
      documentType: record.documentType,
      chunkSize: record.chunkSize,
      chunkOverlap: record.chunkOverlap,
      retrievalConfig: parseRetrievalConfig(record.retrievalConfig),
      syncConfig: parseRetrievalConfig(record.syncConfig),
    };
    try {
      await registerKnowledgeBaseProfile(values);
      knowledgeBaseForm.setFieldsValue(values);
      setRetrievalCompareProfileKey(values.key);
      message.success('调优配置副本已建立，可修改参数后保存并与原配置对照');
      await loadGovernance();
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : '复制配置失败，请确认 Key 是否重复',
      );
    }
  };

  const handleRunRetrievalDebug = async () => {
    const query = retrievalQuery.trim();
    if (!query) {
      message.warning('请输入检索问题');
      return;
    }
    if (
      retrievalCompareProfileKey &&
      retrievalCompareProfileKey === retrievalProfileKey
    ) {
      message.warning('请选择两个不同的配置');
      return;
    }
    setRetrievalDebugLoading(true);
    try {
      if (retrievalCompareProfileKey) {
        const response = await compareGovernanceRetrieval(
          query,
          retrievalProfileKey,
          retrievalCompareProfileKey,
        );
        const comparison = unwrapData<any>(response);
        setRetrievalDebugVariants(
          (comparison?.variants ?? []).map((variant: any) => ({
            key: variant.key,
            result: unwrapData<any>(variant.result),
          })),
        );
      } else {
        const response = await debugGovernanceRetrieval(
          query,
          undefined,
          retrievalProfileKey,
        );
        setRetrievalDebugVariants([
          { key: retrievalProfileKey, result: unwrapData<any>(response) },
        ]);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '检索调试失败');
      setRetrievalDebugVariants(null);
    } finally {
      setRetrievalDebugLoading(false);
    }
  };

  const handleRegisterPlugin = async () => {
    const values = await pluginForm.validateFields();
    try {
      await registerGovernancePlugin({
        ...values,
        tools: String(values.tools ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        modes: values.modes ?? ['production'],
      });
      pluginForm.resetFields();
      message.success('插件已登记，可在产研运工作流中组合使用');
      await loadGovernance();
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : '插件登记失败，请确认工具已在 Tool Registry 注册',
      );
    }
  };

  const handleTogglePlugin = async (plugin: any) => {
    if (plugin.builtin) {
      message.info(
        '内置插件随代码发布，不支持在后台停用；可在工作流中不选择它',
      );
      return;
    }
    try {
      await setGovernancePluginStatus(
        plugin.key,
        plugin.version,
        plugin.status === 'enabled' ? 'disabled' : 'enabled',
      );
      await loadGovernance();
      message.success(
        plugin.status === 'enabled' ? '插件已停用' : '插件已启用',
      );
    } catch {
      message.error('插件状态更新失败');
    }
  };

  const handlePreviewPluginComposition = async () => {
    const pluginKeys = workflowForm.getFieldValue('pluginKeys') ?? [
      'workflow.production-base',
    ];
    try {
      const result = await resolveGovernancePluginComposition(
        pluginKeys,
        'production',
      );
      setPluginPreview(unwrapData<any>(result));
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : '插件组合校验失败',
      );
    }
  };

  React.useEffect(() => {
    const currentPath = history.location.pathname.replace(/\/$/, '');
    if (currentPath.endsWith('/governance') || currentPath === '/agent-ops') {
      void loadGovernance();
    }
  }, [loadGovernance]);

  const loadCollaboration = React.useCallback(async () => {
    setCollaborationLoading(true);
    try {
      const [sops, messages, dependencies, decisions, tasks, events, metrics] =
        await Promise.all([
          getCollaborationSops(),
          getCollaborationMessages(),
          getArtifactDependencies(),
          getDecisionRecords(),
          getAgentTasks(),
          getRuntimeEvents(undefined, runtimeRunId),
          getRuntimeEventMetrics(undefined, runtimeRunId),
        ]);
      setCollaborationSops(unwrapData<any[]>(sops) ?? []);
      setCollaborationMessages(unwrapData<any[]>(messages) ?? []);
      setArtifactDependencies(unwrapData<any[]>(dependencies) ?? []);
      setDecisionRecords(unwrapData<any[]>(decisions) ?? []);
      setAgentTasks(unwrapData<any[]>(tasks) ?? []);
      setRuntimeEvents(unwrapData<any[]>(events) ?? []);
      setRuntimeMetrics(unwrapData<Record<string, number>>(metrics) ?? {});
    } catch {
      message.error('协作编排数据加载失败，请检查 Agent Backend 服务');
    } finally {
      setCollaborationLoading(false);
    }
  }, [runtimeRunId]);

  React.useEffect(() => {
    if (history.location.pathname.endsWith('/collaboration'))
      void loadCollaboration();
  }, [loadCollaboration]);

  const handleCreateDecision = async () => {
    const values = await decisionForm.validateFields();
    try {
      await createDecisionRecord({
        ...values,
        conflicts: values.conflicts
          ? values.conflicts.split('\n').filter(Boolean)
          : [],
        options: values.options
          ? values.options.split('\n').filter(Boolean)
          : [],
      });
      decisionForm.resetFields();
      message.success('Decision Record 已保存');
      await loadCollaboration();
    } catch {
      message.error('Decision Record 保存失败');
    }
  };

  const handleDelegateTask = async () => {
    const values = await delegateForm.validateFields();
    try {
      await delegateAgentTask(values);
      delegateForm.resetFields();
      message.success('Agent 子任务已受控委派');
      await loadCollaboration();
    } catch {
      message.error('Agent 子任务委派失败');
    }
  };

  const handleStartWorkflow = async () => {
    const values = await workflowForm.validateFields();
    const serialized = JSON.stringify(values);
    let pending: { requestId: string; serialized: string } | null = null;
    try {
      const stored = window.localStorage.getItem(pendingStartKey);
      pending = stored ? JSON.parse(stored) : null;
    } catch {
      pending = null;
    }
    const requestId = pending?.serialized === serialized
      ? pending.requestId
      : window.crypto.randomUUID();
    window.localStorage.setItem(
      pendingStartKey,
      JSON.stringify({ requestId, serialized }),
    );
    setLoading(true);
    try {
      const result = await startProductionWorkflow({ ...values, requestId });
      const nextWorkflow = unwrapData<ProductionWorkflow>(result);
      window.localStorage.removeItem(pendingStartKey);
      setWorkflow(nextWorkflow);
      void loadProductionWorkflows();
      window.localStorage.setItem(
        CURRENT_PRODUCTION_WORKFLOW_KEY,
        nextWorkflow.threadId,
      );
      history.push(
        `/agent-ops/workflows/${encodeURIComponent(nextWorkflow.threadId)}`,
      );
      workflowForm.setFieldValue(
        'rerunRoles',
        nextWorkflow.pendingApprovalRoles,
      );
      message.success('工作流已进入后台执行');
    } catch {
      message.warning('启动结果尚未确认；可用相同表单重试，系统会沿用本次请求 ID');
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async (approval: 'approved' | 'rejected') => {
    if (!workflow) return;
    const feedback = workflowForm.getFieldValue('feedback');
    setLoading(true);
    try {
      const result = await resumeProductionWorkflow(workflow.threadId, {
        approval,
        feedback,
        rerunRoles:
          approval === 'rejected'
            ? workflowForm.getFieldValue('rerunRoles')
            : undefined,
      });
      const nextWorkflow = unwrapData<ProductionWorkflow>(result);
      setWorkflow(nextWorkflow);
      void loadProductionWorkflows();
      window.localStorage.setItem(
        CURRENT_PRODUCTION_WORKFLOW_KEY,
        nextWorkflow.threadId,
      );
      workflowForm.setFieldValue('feedback', '');
      workflowForm.setFieldValue(
        'rerunRoles',
        nextWorkflow.pendingApprovalRoles,
      );
    } finally {
      setLoading(false);
    }
  };

  const handleEval = async () => {
    const values = await evalForm.validateFields();
    setLoading(true);
    setEvalResult(null);
    try {
      const result = await evaluateAgent({
        ...values,
        contexts: values.contexts
          .split('\n')
          .map((item: string) => item.trim())
          .filter(Boolean),
        requiredClaims: values.requiredClaims
          ?.split(/[，,\n]/)
          .map((item: string) => item.trim())
          .filter(Boolean),
        expectedContextClaims: values.expectedContextClaims
          ?.split(/[，,\n]/)
          .map((item: string) => item.trim())
          .filter(Boolean),
      });
      setEvalResult(unwrapData<AgentEvalResult>(result));
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async () => {
    if (!selectedBadCase) return;
    const values = await reviewForm.validateFields();
    setLoading(true);
    try {
      const result = unwrapData<
        AgentBadCase & { indexing?: AgentBadCase['indexing'] }
      >(await reviewAgentBadCase(selectedBadCase.id, values));
      if (
        ['milvus_unavailable', 'index_failed', 'remove_failed'].includes(
          result.indexing?.reason ?? '',
        )
      ) {
        message.warning(
          '审核已保存，但 Milvus 不可用，暂未完成回灌，请稍后重试',
        );
      } else if (result.knowledgeLayer === 'formal') {
        message.success(
          '审核已保存，纠正内容已晋升为正式知识并进入主知识库索引',
        );
      } else if (result.indexing?.removed) {
        message.success('审核结果已保存，历史 Bad Case 索引已撤销');
      } else {
        message.success('审核结果已保存；满足门禁时已进入动态 Few-Shot');
      }
      setSelectedBadCase(null);
      await loadBadCases();
    } finally {
      setLoading(false);
    }
  };

  return {
    workflowForm,
    evalForm,
    reviewForm,
    knowledgeBaseForm,
    pluginForm,
    decisionForm,
    delegateForm,
    workflow,
    setWorkflow,
    productionWorkflows,
    setProductionWorkflows,
    workflowListLoading,
    setWorkflowListLoading,
    evalResult,
    setEvalResult,
    badCases,
    setBadCases,
    traces,
    setTraces,
    runSnapshot,
    setRunSnapshot,
    runOptions,
    setRunOptions,
    runCenter,
    setRunCenter,
    runSummary,
    setRunSummary,
    ragQuality,
    setRagQuality,
    intentRouting,
    setIntentRouting,
    securityPolicies,
    setSecurityPolicies,
    securityAudit,
    setSecurityAudit,
    artifactThreadId,
    setArtifactThreadId,
    artifactLoading,
    setArtifactLoading,
    runOptionsLoading,
    setRunOptionsLoading,
    selectedBadCase,
    setSelectedBadCase,
    loading,
    setLoading,
    governanceModels,
    setGovernanceModels,
    governancePlugins,
    setGovernancePlugins,
    governanceWorkflows,
    setGovernanceWorkflows,
    evaluationCases,
    setEvaluationCases,
    knowledgeBaseProfiles,
    setKnowledgeBaseProfiles,
    retrievalQuery,
    setRetrievalQuery,
    retrievalProfileKey,
    setRetrievalProfileKey,
    retrievalCompareProfileKey,
    setRetrievalCompareProfileKey,
    retrievalDebugVariants,
    setRetrievalDebugVariants,
    retrievalDebugLoading,
    setRetrievalDebugLoading,
    governanceLoading,
    setGovernanceLoading,
    pluginPreview,
    setPluginPreview,
    collaborationSops,
    setCollaborationSops,
    collaborationMessages,
    setCollaborationMessages,
    artifactDependencies,
    setArtifactDependencies,
    decisionRecords,
    setDecisionRecords,
    collaborationReplay,
    setCollaborationReplay,
    collaborationConflicts,
    setCollaborationConflicts,
    agentTasks,
    setAgentTasks,
    collaborationLoading,
    setCollaborationLoading,
    runtimeEvents,
    setRuntimeEvents,
    runtimeMetrics,
    setRuntimeMetrics,
    runtimeRunId,
    setRuntimeRunId,
    loadBadCases,
    loadTraces,
    loadRunOptions,
    loadRunSummary,
    loadRagQuality,
    loadIntentRouting,
    loadSecurityPolicies,
    loadSecurityAudit,
    loadRunArtifacts,
    loadRunCenter,
    loadProductionWorkflows,
    handleRetryRun,
    loadGovernance,
    handleCloneWorkflow,
    handleRegisterKnowledgeBase,
    handleCloneKnowledgeBaseProfile,
    handleRunRetrievalDebug,
    handleRegisterPlugin,
    handleTogglePlugin,
    handlePreviewPluginComposition,
    loadCollaboration,
    handleCreateDecision,
    handleDelegateTask,
    handleStartWorkflow,
    handleResume,
    handleEval,
    handleReview,
  };
}

export type AgentOpsController = ReturnType<typeof useAgentOpsController>;
