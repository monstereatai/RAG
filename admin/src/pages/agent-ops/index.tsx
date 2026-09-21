import {
  CheckOutlined,
  CloseOutlined,
  ExperimentOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { AssistantMarkdown } from "@/components/AssistantMarkdown";
import { ModulePage, agentOpsNav } from "@/components/AdminShell";
import { history } from "@umijs/max";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import React from "react";
import { XMarkdown } from "@ant-design/x-markdown";
import "@ant-design/x-markdown/es/XMarkdown/index.css";
import { ScheduledAnalysisPanel } from "./scheduled-analysis-panel";
import {
  type AgentBadCase,
  type AgenticRunOption,
  type AgenticRunSnapshot,
  type AgentEvalResult,
  type ProductionRole,
  type ProductionWorkflow,
  type TraceSnapshot,
  type AgentRunSummary,
  type RagQualitySummary,
  type IntentRoutingSummary,
  evaluateAgent,
  getAgentBadCases,
  getAgentRuns,
  getAgentRunSummary,
  getSecurityPolicies,
  getSecurityAudit,
  getRagQualitySummary,
  getIntentRoutingSummary,
  getAgentRunArtifacts,
  getAgentRunCenter,
  retryAgentRunRecord,
  getAgentTraces,
  debugGovernanceRetrieval,
  getGovernanceEvaluationCases,
  getGovernanceModels,
  getGovernancePlugins,
  getGovernanceWorkflows,
  cloneGovernanceWorkflow,
  getCollaborationSops,
  getCollaborationMessages,
  getArtifactDependencies,
  getDecisionRecords,
  getCollaborationConflicts,
  createDecisionRecord,
  getCollaborationReplay,
  getAgentTasks,
  retryAgentTask,
  getRuntimeEvents,
  getRuntimeEventMetrics,
  delegateAgentTask,
  getKnowledgeBaseProfiles,
  registerKnowledgeBaseProfile,
  registerGovernancePlugin,
  resolveGovernancePluginComposition,
  setGovernancePluginStatus,
  getProductionWorkflow,
  getProductionWorkflows,
  retryAgentRun,
  resumeProductionWorkflow,
  reviewAgentBadCase,
  startProductionWorkflow,
  unwrapData,
} from "./service";

const ROLE_LABELS: Record<ProductionRole, string> = {
  product: "产品",
  design: "设计",
  frontend: "前端",
  backend: "后端",
  qa: "测试",
  operations: "运营",
};
const METRIC_LABELS: Record<string, string> = {
  task_success_rate: "任务成功",
  faithfulness: "忠实度",
  prd_coverage: "需求覆盖",
  test_case_completeness: "用例完整",
  tool_success_rate: "工具成功",
  step_accuracy: "步骤准确",
  human_handoff_rate: "人工接管",
};

const ARTIFACT_LABELS: Record<string, string> = {
  subquestion_plan: "子问题计划",
  evidence_bundle: "证据包",
  answer_contract: "答案契约",
  requirement_brief: "需求简报",
  assumption_register: "假设登记",
  claim_evidence_matrix: "声明证据矩阵",
  solution_brief: "方案简报",
  api_contract: "接口契约",
  event_tracking_plan: "埋点方案",
  test_plan: "测试计划",
  acceptance_checklist: "验收清单",
  risk_register: "风险登记",
  rollout_plan: "上线计划",
  code_context_pack: "AI Coding 上下文包",
};

const CURRENT_PRODUCTION_WORKFLOW_KEY = "agent-ops.current-production-workflow";
const WORKFLOW_STATUS_LABELS: Record<ProductionWorkflow["status"], string> = {
  running: "运行中",
  pending_approval: "待审批",
  revision_required: "待修订",
  completed: "已完成",
  failed: "失败",
};

const normalizeArtifactMarkdown = (content: string) =>
  content
    .replace(/\r\n/g, "\n")
    .replace(/```([A-Za-z0-9_-]+)\s+(?=\S)/g, "```$1\n");

export default function AgentOpsPage() {
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
  const [productionWorkflows, setProductionWorkflows] = React.useState<ProductionWorkflow[]>([]);
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
  const [runSummary, setRunSummary] = React.useState<AgentRunSummary | null>(null);
  const [ragQuality, setRagQuality] = React.useState<RagQualitySummary | null>(null);
  const [intentRouting, setIntentRouting] = React.useState<IntentRoutingSummary | null>(null);
  const [securityPolicies, setSecurityPolicies] = React.useState<Array<{ id?: string; name?: string; severity?: string }>>([]);
  const [securityAudit, setSecurityAudit] = React.useState<Array<{ id?: string; eventType?: string; payload?: any; createdAt?: string }>>([]);
  const [artifactThreadId, setArtifactThreadId] = React.useState("");
  const [artifactLoading, setArtifactLoading] = React.useState(false);
  const [runOptionsLoading, setRunOptionsLoading] = React.useState(false);
  const [selectedBadCase, setSelectedBadCase] =
    React.useState<AgentBadCase | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [governanceModels, setGovernanceModels] = React.useState<any[]>([]);
  const [governancePlugins, setGovernancePlugins] = React.useState<any[]>([]);
  const [governanceWorkflows, setGovernanceWorkflows] = React.useState<any[]>([]);
  const [evaluationCases, setEvaluationCases] = React.useState<any[]>([]);
  const [knowledgeBaseProfiles, setKnowledgeBaseProfiles] = React.useState<any[]>([]);
  const [retrievalQuery, setRetrievalQuery] = React.useState("");
  const [retrievalProfileKey, setRetrievalProfileKey] = React.useState("general");
  const [retrievalDebug, setRetrievalDebug] = React.useState<any>(null);
  const [governanceLoading, setGovernanceLoading] = React.useState(false);
  const [pluginPreview, setPluginPreview] = React.useState<any>(null);
  const [collaborationSops, setCollaborationSops] = React.useState<any[]>([]);
  const [collaborationMessages, setCollaborationMessages] = React.useState<any[]>([]);
  const [artifactDependencies, setArtifactDependencies] = React.useState<any[]>([]);
  const [decisionRecords, setDecisionRecords] = React.useState<any[]>([]);
  const [collaborationReplay, setCollaborationReplay] = React.useState<any>(null);
  const [collaborationConflicts, setCollaborationConflicts] = React.useState<any[]>([]);
  const [agentTasks, setAgentTasks] = React.useState<any[]>([]);
  const [collaborationLoading, setCollaborationLoading] = React.useState(false);
  const [runtimeEvents, setRuntimeEvents] = React.useState<any[]>([]);
  const [runtimeMetrics, setRuntimeMetrics] = React.useState<Record<string, number>>({});
  const [runtimeRunId, setRuntimeRunId] = React.useState<string>();

  /** Bad Case 审核是运营闭环入口；加载失败提示服务状态，不将空数组误作「没有问题」。 */
  const loadBadCases = React.useCallback(async () => {
    try {
      const result = await getAgentBadCases();
      setBadCases(unwrapData<AgentBadCase[]>(result) ?? []);
    } catch {
      message.error("Bad Case 加载失败，请检查登录状态和 Agent Backend 服务");
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
      message.error("最近 Agentic 会话加载失败");
    } finally {
      setRunOptionsLoading(false);
    }
  }, [artifactThreadId]);
  const loadRunSummary = React.useCallback(async () => {
    try {
      setRunSummary(unwrapData<AgentRunSummary>(await getAgentRunSummary()));
    } catch {
      message.error("Agent 运行汇总加载失败");
    }
  }, []);
  const loadRagQuality = React.useCallback(async () => {
    try {
      setRagQuality(unwrapData<RagQualitySummary>(await getRagQualitySummary()));
    } catch {
      message.error("RAG 质量汇总加载失败");
    }
  }, []);
  const loadIntentRouting = React.useCallback(async () => {
    try {
      setIntentRouting(unwrapData<IntentRoutingSummary>(await getIntentRoutingSummary()));
    } catch {
      message.error("意图路由数据加载失败");
    }
  }, []);
  const loadSecurityPolicies = React.useCallback(async () => {
    try {
      const result = unwrapData<{ policies?: Array<{ id?: string; name?: string; severity?: string }> }>(await getSecurityPolicies());
      setSecurityPolicies(result?.policies ?? []);
    } catch {
      message.error("安全策略加载失败");
    }
  }, []);
  const loadSecurityAudit = React.useCallback(async () => {
    try {
      const result = unwrapData<{ events?: Array<{ id?: string; eventType?: string; payload?: any; createdAt?: string }> }>(await getSecurityAudit());
      setSecurityAudit(result?.events ?? []);
    } catch {
      message.error("安全审计事件加载失败");
    }
  }, []);
  const loadRunArtifacts = async () => {
    const threadId = artifactThreadId.trim();
    if (!threadId) {
      message.warning("请输入 Thread ID");
      return;
    }
    setArtifactLoading(true);
    try {
      const result = await getAgentRunArtifacts(threadId);
      setRunSnapshot(unwrapData<AgenticRunSnapshot>(result));
    } catch {
      message.error("Artifact 状态加载失败，请检查服务和 Thread ID");
    } finally {
      setArtifactLoading(false);
    }
  };
  const loadRunCenter = React.useCallback(async () => {
    try {
      const result = await getAgentRunCenter();
      setRunCenter(unwrapData<any[]>(result) ?? []);
    } catch {
      message.error("运行中心加载失败，请检查 Agent Backend 服务");
    }
  }, []);
  const loadProductionWorkflows = React.useCallback(async () => {
    setWorkflowListLoading(true);
    try {
      const result = await getProductionWorkflows();
      setProductionWorkflows(unwrapData<ProductionWorkflow[]>(result) ?? []);
    } catch {
      message.error("产研运工作流列表加载失败");
    } finally {
      setWorkflowListLoading(false);
    }
  }, []);
  const handleRetryRun = async () => {
    if (!runSnapshot?.available) return;
    setArtifactLoading(true);
    try {
      await retryAgentRun(runSnapshot.threadId);
      message.success("已重新执行 Agentic 链路，请稍后刷新查看新 Artifact");
      await loadRunArtifacts();
    } catch {
      message.error("重新执行失败，请检查模型、索引和 Redis 状态");
    } finally {
      setArtifactLoading(false);
    }
  };

  React.useEffect(() => {
    void Promise.all([loadBadCases(), loadTraces(), loadRunOptions(), loadRunSummary(), loadRagQuality(), loadIntentRouting(), loadSecurityPolicies(), loadSecurityAudit(), loadRunCenter(), loadProductionWorkflows()]).catch(
      () => undefined,
    );
  }, [loadBadCases, loadIntentRouting, loadRunCenter, loadRunOptions, loadRunSummary, loadRagQuality, loadSecurityAudit, loadSecurityPolicies, loadTraces, loadProductionWorkflows]);

  React.useEffect(() => {
    const threadId = window.localStorage.getItem(
      CURRENT_PRODUCTION_WORKFLOW_KEY,
    );
    if (!threadId) return;
    void getProductionWorkflow(threadId)
      .then((result) => {
        const nextWorkflow = unwrapData<ProductionWorkflow>(result);
        if (!nextWorkflow?.threadId) return;
        if (nextWorkflow.status === "completed" || nextWorkflow.status === "failed") {
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
    if (workflow?.status !== "running") return;
    const timer = window.setTimeout(() => {
      void getProductionWorkflow(workflow.threadId)
        .then((result) => {
          const nextWorkflow = unwrapData<ProductionWorkflow>(result);
          void loadProductionWorkflows();
          if (nextWorkflow.status === "completed" || nextWorkflow.status === "failed") {
            setWorkflow(null);
            workflowForm.resetFields();
            window.localStorage.removeItem(CURRENT_PRODUCTION_WORKFLOW_KEY);
            message.success(
              nextWorkflow.status === "completed"
                ? "工作流已完成，详情已收起，可从列表重新查看"
                : "工作流已结束，详情已收起，可从列表重新查看",
            );
            return;
          }
          setWorkflow(nextWorkflow);
          workflowForm.setFieldValue(
            "rerunRoles",
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
      setKnowledgeBaseProfiles(unwrapData<any[]>(profiles) ?? []);
    } catch {
      message.error("平台治理数据加载失败，请检查 Agent Backend 服务");
    } finally {
      setGovernanceLoading(false);
    }
  }, []);

  const handleCloneWorkflow = async (record: any) => {
    const key = window.prompt("请输入副本 Key", `${record.key}-copy`);
    if (!key?.trim()) return;
    try {
      await cloneGovernanceWorkflow(record.id, { key: key.trim(), name: `${record.name}（副本）` });
      message.success("工作流副本已创建");
      await loadGovernance();
    } catch {
      message.error("工作流复制失败，请检查 Key 是否重复");
    }
  };

  const handleRegisterKnowledgeBase = async () => {
    const values = await knowledgeBaseForm.validateFields();
    setGovernanceLoading(true);
    try {
      await registerKnowledgeBaseProfile(values);
      message.success("知识库配置已保存，后续入库和问答会按配置生效");
      knowledgeBaseForm.resetFields();
      await loadGovernance();
    } finally {
      setGovernanceLoading(false);
    }
  };

  const handleRegisterPlugin = async () => {
    const values = await pluginForm.validateFields();
    try {
      await registerGovernancePlugin({
        ...values,
        tools: String(values.tools ?? "").split(",").map((item) => item.trim()).filter(Boolean),
        modes: values.modes ?? ["production"],
      });
      pluginForm.resetFields();
      message.success("插件已登记，可在产研运工作流中组合使用");
      await loadGovernance();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "插件登记失败，请确认工具已在 Tool Registry 注册");
    }
  };

  const handleTogglePlugin = async (plugin: any) => {
    if (plugin.builtin) {
      message.info("内置插件随代码发布，不支持在后台停用；可在工作流中不选择它");
      return;
    }
    try {
      await setGovernancePluginStatus(plugin.key, plugin.version, plugin.status === "enabled" ? "disabled" : "enabled");
      await loadGovernance();
      message.success(plugin.status === "enabled" ? "插件已停用" : "插件已启用");
    } catch {
      message.error("插件状态更新失败");
    }
  };

  const handlePreviewPluginComposition = async () => {
    const pluginKeys = workflowForm.getFieldValue("pluginKeys") ?? ["workflow.production-base"];
    try {
      const result = await resolveGovernancePluginComposition(pluginKeys, "production");
      setPluginPreview(unwrapData<any>(result));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "插件组合校验失败");
    }
  };

  React.useEffect(() => {
    const currentPath = history.location.pathname.replace(/\/$/, "");
    if (currentPath.endsWith("/governance") || currentPath === "/agent-ops") {
      void loadGovernance();
    }
  }, [loadGovernance]);

  const loadCollaboration = React.useCallback(async () => {
    setCollaborationLoading(true);
    try {
      const [sops, messages, dependencies, decisions, tasks, events, metrics] = await Promise.all([
        getCollaborationSops(), getCollaborationMessages(), getArtifactDependencies(), getDecisionRecords(), getAgentTasks(), getRuntimeEvents(undefined, runtimeRunId), getRuntimeEventMetrics(undefined, runtimeRunId),
      ]);
      setCollaborationSops(unwrapData<any[]>(sops) ?? []);
      setCollaborationMessages(unwrapData<any[]>(messages) ?? []);
      setArtifactDependencies(unwrapData<any[]>(dependencies) ?? []);
      setDecisionRecords(unwrapData<any[]>(decisions) ?? []);
      setAgentTasks(unwrapData<any[]>(tasks) ?? []);
      setRuntimeEvents(unwrapData<any[]>(events) ?? []);
      setRuntimeMetrics(unwrapData<Record<string, number>>(metrics) ?? {});
    } catch { message.error("协作编排数据加载失败，请检查 Agent Backend 服务"); }
    finally { setCollaborationLoading(false); }
  }, [runtimeRunId]);

  React.useEffect(() => {
    if (history.location.pathname.endsWith("/collaboration")) void loadCollaboration();
  }, [loadCollaboration]);

  const handleCreateDecision = async () => {
    const values = await decisionForm.validateFields();
    try {
      await createDecisionRecord({ ...values, conflicts: values.conflicts ? values.conflicts.split("\n").filter(Boolean) : [], options: values.options ? values.options.split("\n").filter(Boolean) : [] });
      decisionForm.resetFields();
      message.success("Decision Record 已保存");
      await loadCollaboration();
    } catch { message.error("Decision Record 保存失败"); }
  };

  const handleDelegateTask = async () => {
    const values = await delegateForm.validateFields();
    try {
      await delegateAgentTask(values);
      delegateForm.resetFields();
      message.success("Agent 子任务已受控委派");
      await loadCollaboration();
    } catch { message.error("Agent 子任务委派失败"); }
  };

  const handleStartWorkflow = async () => {
    const values = await workflowForm.validateFields();
    setLoading(true);
    try {
      const result = await startProductionWorkflow(values);
      const nextWorkflow = unwrapData<ProductionWorkflow>(result);
      setWorkflow(nextWorkflow);
      void loadProductionWorkflows();
      window.localStorage.setItem(
        CURRENT_PRODUCTION_WORKFLOW_KEY,
        nextWorkflow.threadId,
      );
      history.push(`/agent-ops/workflows/${encodeURIComponent(nextWorkflow.threadId)}`);
      workflowForm.setFieldValue(
        "rerunRoles",
        nextWorkflow.pendingApprovalRoles,
      );
      message.success("工作流已进入后台执行");
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async (approval: "approved" | "rejected") => {
    if (!workflow) return;
    const feedback = workflowForm.getFieldValue("feedback");
    setLoading(true);
    try {
      const result = await resumeProductionWorkflow(workflow.threadId, {
        approval,
        feedback,
        rerunRoles:
          approval === "rejected"
            ? workflowForm.getFieldValue("rerunRoles")
            : undefined,
      });
      const nextWorkflow = unwrapData<ProductionWorkflow>(result);
      setWorkflow(nextWorkflow);
      void loadProductionWorkflows();
      window.localStorage.setItem(
        CURRENT_PRODUCTION_WORKFLOW_KEY,
        nextWorkflow.threadId,
      );
      workflowForm.setFieldValue("feedback", "");
      workflowForm.setFieldValue(
        "rerunRoles",
        nextWorkflow.pendingApprovalRoles,
      );
    } finally {
      setLoading(false);
    }
  };

  const handleEval = async () => {
    const values = await evalForm.validateFields();
    setLoading(true);
    try {
      const result = await evaluateAgent({
        ...values,
        contexts: values.contexts.split("\n").filter(Boolean),
        requiredClaims: values.requiredClaims
          ?.split(/[，,\n]/)
          .map((item: string) => item.trim())
          .filter(Boolean),
        expectedSteps: ["retrieval", "generate"],
        actualSteps: ["retrieval", "generate"],
        toolCalls: [{ name: "retrieval", success: true }],
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
      const result = unwrapData<AgentBadCase & { indexing?: AgentBadCase["indexing"] }>(
        await reviewAgentBadCase(selectedBadCase.id, values),
      );
      if (
        ["milvus_unavailable", "index_failed", "remove_failed"].includes(
          result.indexing?.reason ?? "",
        )
      ) {
        message.warning("审核已保存，但 Milvus 不可用，暂未完成回灌，请稍后重试");
      } else if (result.knowledgeLayer === "formal") {
        message.success("审核已保存，纠正内容已晋升为正式知识并进入主知识库索引");
      } else if (result.indexing?.removed) {
        message.success("审核结果已保存，历史 Bad Case 索引已撤销");
      } else {
        message.success("审核结果已保存；满足门禁时已进入动态 Few-Shot");
      }
      setSelectedBadCase(null);
      await loadBadCases();
    } finally {
      setLoading(false);
    }
  };

  const workflowPanel = (
    <section className="agent-ops-panel">
      <Card title="Agent 运行质量汇总" size="small" style={{ marginBottom: 16 }} extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => void loadRunSummary()}>刷新</Button>}>
        {runSummary ? (
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }}>
            <Descriptions.Item label="成功率">{(runSummary.successRate * 100).toFixed(1)}%</Descriptions.Item>
            <Descriptions.Item label="失败率">{(runSummary.failureRate * 100).toFixed(1)}%</Descriptions.Item>
            <Descriptions.Item label="成本">${runSummary.totalCostUsd.toFixed(4)}</Descriptions.Item>
            <Descriptions.Item label="工具调用">{runSummary.totalToolCalls}</Descriptions.Item>
            <Descriptions.Item label="扫描运行">{runSummary.scanned}</Descriptions.Item>
            <Descriptions.Item label="重试次数">{runSummary.totalRetries}</Descriptions.Item>
            <Descriptions.Item label="需审批／预算超限">{runSummary.budgetExceededRuns}</Descriptions.Item>
            <Descriptions.Item label="步骤准确率">{((runSummary.stepAccuracy ?? 0) * 100).toFixed(1)}%</Descriptions.Item>
            <Descriptions.Item label="恢复成功率">{((runSummary.recoveryRate ?? 0) * 100).toFixed(1)}%</Descriptions.Item>
            <Descriptions.Item label="运行成功率">{((runSummary.qualityLayers?.runSuccessRate ?? runSummary.successRate) * 100).toFixed(1)}%</Descriptions.Item>
            <Descriptions.Item label="工具成功率">{((runSummary.qualityLayers?.toolSuccessRate ?? 0) * 100).toFixed(1)}%</Descriptions.Item>
            <Descriptions.Item label="任务正确率">{((runSummary.qualityLayers?.taskAccuracy ?? runSummary.stepAccuracy ?? 0) * 100).toFixed(1)}%</Descriptions.Item>
            <Descriptions.Item label="交付可用率">{((runSummary.qualityLayers?.deliveryReadyRate ?? 0) * 100).toFixed(1)}%</Descriptions.Item>
          </Descriptions>
        ) : <Alert type="info" showIcon message="暂无运行汇总数据" />}
      </Card>
      <Card title="RAG 质量门禁" size="small" style={{ marginBottom: 16 }} extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => void loadRagQuality()}>刷新</Button>}>
        {ragQuality ? <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }}>
          <Descriptions.Item label="回答率">{(ragQuality.answerRate * 100).toFixed(1)}%</Descriptions.Item>
          <Descriptions.Item label="引用率">{(ragQuality.citationRate * 100).toFixed(1)}%</Descriptions.Item>
          <Descriptions.Item label="拒答率">{(ragQuality.refusalRate * 100).toFixed(1)}%</Descriptions.Item>
          <Descriptions.Item label="平均延迟">{Math.round(ragQuality.averageLatencyMs)} ms</Descriptions.Item>
          <Descriptions.Item label="发布判定"><Tag color={ragQuality.gate?.passed ? "green" : "red"}>{ragQuality.gate?.passed ? "通过" : "不通过"}</Tag></Descriptions.Item>
          {!ragQuality.gate?.passed && <Descriptions.Item label="失败原因" span={3}>{ragQuality.gate?.reasons?.join("；") || "暂无"}</Descriptions.Item>}
        </Descriptions> : <Alert type="info" showIcon message="暂无 RAG 质量汇总数据" />}
      </Card>
      <Card title="意图路由运营" size="small" style={{ marginBottom: 16 }} extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => void loadIntentRouting()}>刷新</Button>}>
        {intentRouting ? <>
          <Alert
            type={intentRouting.estimated ? "warning" : "info"}
            showIcon
            style={{ marginBottom: 12 }}
            message={intentRouting.note ?? "路由统计已加载"}
          />
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }}>
            <Descriptions.Item label="扫描问答">{intentRouting.scanned}</Descriptions.Item>
            <Descriptions.Item label="进入检索">{intentRouting.byAction.retrieve ?? 0}</Descriptions.Item>
            <Descriptions.Item label="直接回答">{intentRouting.byAction.direct_answer ?? 0}</Descriptions.Item>
            <Descriptions.Item label="私域／上下文">{intentRouting.byQueryType.private_or_context ?? 0}</Descriptions.Item>
          </Descriptions>
          <Table
            size="small"
            style={{ marginTop: 12 }}
            rowKey="id"
            pagination={{ pageSize: 6 }}
            dataSource={intentRouting.recent}
            columns={[
              { title: "问题", dataIndex: "query", ellipsis: true },
              { title: "动作", dataIndex: "action", render: (value: string) => <Tag color={value === "retrieve" ? "blue" : "green"}>{value === "retrieve" ? "检索" : "直答"}</Tag> },
              { title: "类型", dataIndex: "queryType" },
              { title: "模式", dataIndex: "mode" },
              { title: "证据", render: (_: unknown, row: IntentRoutingSummary["recent"][number]) => row.cited ? <Tag color="green">有引用</Tag> : <Tag>无引用</Tag> },
              { title: "时间", dataIndex: "createdAt", render: (value: string) => value ? new Date(value).toLocaleString("zh-CN") : "-" },
            ]}
          />
        </> : <Alert type="info" showIcon message="暂无意图路由数据" />}
      </Card>
      <Card title={`RAG 安全策略（审计事件 ${securityAudit.length}）`} size="small" style={{ marginBottom: 16 }} extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => void Promise.all([loadSecurityPolicies(), loadSecurityAudit()])}>刷新</Button>}>
        <Space wrap>
          {securityPolicies.map((policy) => <Tag key={policy.id ?? policy.name} color={policy.severity === "high" ? "red" : "orange"}>{policy.name ?? policy.id}</Tag>)}
          {!securityPolicies.length && <Typography.Text type="secondary">暂无策略或服务未连接</Typography.Text>}
        </Space>
        <Table
          size="small"
          style={{ marginTop: 12 }}
          rowKey={(row) => row.id ?? `${row.createdAt}-${row.eventType}`}
          dataSource={securityAudit}
          pagination={{ pageSize: 5 }}
          locale={{ emptyText: "暂无拦截事件" }}
          columns={[
            { title: "时间", dataIndex: "createdAt", render: (value: string) => value ? new Date(value).toLocaleString() : "-" },
            { title: "策略", render: (_: unknown, row: any) => row.payload?.pattern ?? "-" },
            { title: "路由", render: (_: unknown, row: any) => row.payload?.route ?? "-" },
            { title: "用户", render: (_: unknown, row: any) => row.payload?.userId ?? "-" },
            { title: "查询摘要", render: (_: unknown, row: any) => row.payload?.queryHash ? `${String(row.payload.queryHash).slice(0, 12)}…` : "已脱敏" },
          ]}
        />
      </Card>
      <Card
        title="产研运工作流列表"
        size="small"
        extra={<Button icon={<ReloadOutlined />} loading={workflowListLoading} onClick={() => void loadProductionWorkflows()}>刷新</Button>}
        style={{ marginBottom: 16 }}
      >
        <Table
          size="small"
          rowKey="threadId"
          loading={workflowListLoading}
          dataSource={productionWorkflows}
          pagination={{ pageSize: 5 }}
          onRow={(record) => ({
            onClick: () => {
              history.push(`/agent-ops/workflows/${encodeURIComponent(record.threadId)}`);
            },
            style: { cursor: "pointer" },
          })}
          columns={[
            { title: "项目／活动", dataIndex: "projectId" },
            { title: "状态", dataIndex: "status", render: (value: ProductionWorkflow["status"]) => <Tag color={value === "completed" ? "green" : value === "failed" ? "red" : value === "pending_approval" || value === "revision_required" ? "orange" : "blue"}>{WORKFLOW_STATUS_LABELS[value] ?? value}</Tag> },
            { title: "完成岗位", render: (_, record) => `${record.completedRoles?.length ?? 0}/${record.selectedRoles?.length ?? 0}` },
            { title: "当前批次", render: (_, record) => record.currentBatch?.map((role: ProductionRole) => ROLE_LABELS[role]).join("＋") || "已完成" },
            { title: "Thread", dataIndex: "threadId", ellipsis: true },
          ]}
        />
        <div style={{ color: "#667085", marginTop: 8 }}>点击任意工作流查看详情、阶段产物和审批操作。</div>
      </Card>
      <Form form={workflowForm} layout="vertical">
        <div className="agent-ops-form-grid">
          <Form.Item
            label="项目／活动 ID"
            name="projectId"
            rules={[{ required: true }]}
          >
            <Input placeholder="anniversary-2026" />
          </Form.Item>
          <Form.Item label="最大步骤" name="maxSteps" initialValue={18}>
            <InputNumber min={6} max={30} />
          </Form.Item>
          <Form.Item label="审批策略" name="approvalMode" initialValue="auto">
            <Select
              options={[
                { value: "auto", label: "普通任务：自动流转" },
                { value: "risk_based", label: "按风险审批" },
                { value: "required", label: "全部岗位人工审批" },
              ]}
            />
          </Form.Item>
          <Form.Item label="协作策略" name="processType" initialValue="sequential">
            <Select
              options={[
                { value: "sequential", label: "Sequential：按依赖顺序" },
                { value: "hierarchical", label: "Hierarchical：Manager 委派" },
                { value: "conditional", label: "Conditional：按质量分支" },
              ]}
            />
          </Form.Item>
          <Form.Item label="插件能力包" name="pluginKeys" initialValue={["workflow.production-base"]}>
            <Select
              mode="multiple"
              placeholder="选择并组合能力包"
              options={governancePlugins
                .filter((plugin) => plugin.status === "enabled" && (plugin.modes ?? []).includes("production"))
                .map((plugin) => ({ value: plugin.key, label: `${plugin.displayName ?? plugin.key}（${plugin.key}）` }))}
            />
          </Form.Item>
          <Form.Item label="组合校验">
            <Button onClick={() => void handlePreviewPluginComposition()}>预览有效工具</Button>
          </Form.Item>
        </div>
        {pluginPreview && (
          <Alert
            showIcon
            type="info"
            style={{ marginBottom: 16 }}
            title={`已组合：${(pluginPreview.pluginKeys ?? []).join("、") || "无"}`}
            description={`有效工具：${(pluginPreview.toolNames ?? []).join("、") || "无（将只保留模型生成，不调用工具）"}`}
          />
        )}
        <Form.Item
          label="参与岗位"
          name="roles"
          initialValue={Object.keys(ROLE_LABELS)}
          rules={[{ required: true, message: "至少选择一个岗位" }]}
        >
          <Select
            mode="multiple"
            options={Object.entries(ROLE_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
            placeholder="选择独立执行或协作执行的岗位"
          />
        </Form.Item>
        <div className="agent-ops-form-grid">
          <Form.Item
            label="指定审批岗位"
            name="approvalRoles"
            initialValue={[]}
          >
            <Select
              allowClear
              mode="multiple"
              options={Object.entries(ROLE_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
              placeholder="无论风险级别都需要审批"
            />
          </Form.Item>
          <Form.Item
            label="风险审批阈值"
            name="riskApprovalThreshold"
            initialValue="high"
          >
            <Select
              options={[
                { value: "high", label: "仅高风险" },
                { value: "medium", label: "中、高风险" },
              ]}
            />
          </Form.Item>
        </div>
        <Form.Item
          label="需求背景"
          name="brief"
          rules={[{ required: true, min: 10 }]}
        >
          <Input.TextArea
            rows={5}
            placeholder="活动目标、范围、规则、地区版本和上线约束"
          />
        </Form.Item>
        <Button
          loading={loading}
          onClick={() => void handleStartWorkflow()}
          type="primary"
        >
          启动工作流
        </Button>
        {history.location.pathname.includes("/workflows/") && workflow && (
          <div className="agent-workflow-result">
            <Steps
              current={workflow.stageIndex}
              items={workflow.selectedRoles.map((key, index) => ({
                title: ROLE_LABELS[key],
                status:
                  workflow.status === "failed" && index === workflow.stageIndex
                    ? "error"
                    : workflow.completedRoles.includes(key)
                      ? "finish"
                      : workflow.currentBatch.includes(key)
                        ? "process"
                        : "wait",
              }))}
            />
            <Descriptions
              column={2}
              items={[
                { key: "status", label: "状态", children: WORKFLOW_STATUS_LABELS[workflow.status] },
                {
                  key: "steps",
                  label: "步数",
                  children: `${workflow.stepCount}/${workflow.maxSteps}`,
                },
                {
                  key: "approvalMode",
                  label: "审批策略",
                  children:
                    workflow.approvalMode === "required"
                      ? "全部岗位人工审批"
                      : workflow.approvalMode === "risk_based"
                        ? `${workflow.riskApprovalThreshold === "high" ? "高" : "中、高"}风险审批`
                        : "普通任务自动流转",
                },
                { key: "thread", label: "Thread", children: workflow.threadId },
                {
                  key: "batch",
                  label: "当前批次",
                  children:
                    workflow.currentBatch
                      .map((role) => ROLE_LABELS[role])
                      .join("＋") || "已完成",
                },
              ]}
            />
            <Collapse
              items={workflow.selectedRoles
                .filter((role) => workflow.results[role])
                .map((role) => {
                  const result = workflow.results[role];
                  if (!result) return null;
                  const pendingClaims = result.claims.filter(
                    (claim) => claim.status === "pending_confirmation",
                  );
                  return {
                    key: role,
                    label: (
                      <span>
                        {ROLE_LABELS[role]}：{result.summary}{" "}
                        <Tag
                          color={
                            result.riskLevel === "high"
                              ? "red"
                              : result.riskLevel === "medium"
                                ? "orange"
                                : "green"
                          }
                        >
                          {result.riskLevel === "high"
                            ? "高风险"
                            : result.riskLevel === "medium"
                              ? "中风险"
                              : "低风险"}
                        </Tag>
                        <Tag
                          color={
                            result.evidenceCoverage === 1 ? "green" : "orange"
                          }
                        >
                          证据覆盖 {Math.round(result.evidenceCoverage * 100)}%
                        </Tag>
                      </span>
                    ),
                    children: (
                      <div className="agent-stage-output">
                        {pendingClaims.length > 0 && (
                          <Alert
                            showIcon
                            title={`${pendingClaims.length} 条事实声明缺少有效证据，需人工确认`}
                            type="warning"
                          />
                        )}
                        {result.deliverables.map((deliverable) => (
                          <section
                            key={`${deliverable.type}-${deliverable.title}`}
                          >
                            <strong>{deliverable.title}</strong>
                            <XMarkdown
                              className="agent-deliverable-markdown"
                              content={normalizeArtifactMarkdown(
                                deliverable.markdown,
                              )}
                              escapeRawHtml
                              openLinksInNewTab
                              paragraphTag="div"
                            />
                          </section>
                        ))}
                        <p>问题：{result.issues.join("；") || "无"}</p>
                        <p>
                          下游风险：{result.downstreamRisks.join("；") || "无"}
                        </p>
                        <p>
                          工具：
                          {result.toolExecutions
                            .map(
                              (tool) =>
                                `${tool.tool}（${tool.status}，${tool.durationMs}ms）`,
                            )
                            .join("；") || "无"}
                        </p>
                        {result.generatedArtifact && (
                          <p>
                            产物任务：{result.generatedArtifact.title}（
                            {result.generatedArtifact.status}，ID：
                            {result.generatedArtifact.id}）
                          </p>
                        )}
                      </div>
                    ),
                  };
                })
                .filter((item): item is NonNullable<typeof item> => item !== null)}
            />
            {workflow.requiresApproval && (
              <div className="agent-approval-row">
                <Form.Item name="feedback" noStyle>
                  <Input placeholder="驳回时填写修改意见" />
                </Form.Item>
                <Form.Item name="rerunRoles" noStyle>
                  <Select
                    mode="multiple"
                    options={workflow.currentBatch.map((role) => ({
                      value: role,
                      label: ROLE_LABELS[role],
                    }))}
                    placeholder="选择需要重跑的岗位"
                  />
                </Form.Item>
                <Button
                  icon={<CheckOutlined />}
                  loading={loading}
                  onClick={() => void handleResume("approved")}
                  type="primary"
                >
                  批准并继续
                </Button>
                <Button
                  danger
                  icon={<CloseOutlined />}
                  loading={loading}
                  onClick={() => void handleResume("rejected")}
                >
                  驳回并重新处理
                </Button>
              </div>
            )}
          </div>
        )}
      </Form>
    </section>
  );

  const evalPanel = (
    <section className="agent-ops-panel">
      <Form form={evalForm} layout="vertical">
        <Form.Item label="评测问题" name="query" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item
          label="检索证据（每行一段）"
          name="contexts"
          rules={[{ required: true }]}
        >
          <Input.TextArea rows={4} />
        </Form.Item>
        <Form.Item
          label="Agent 输出"
          name="output"
          rules={[{ required: true }]}
        >
          <Input.TextArea rows={6} />
        </Form.Item>
        <div className="agent-ops-form-grid">
          <Form.Item label="任务类型" name="taskType" initialValue="general">
            <Select
              options={[
                { value: "general", label: "通用" },
                { value: "prd", label: "PRD" },
                { value: "test_case", label: "测试用例" },
              ]}
            />
          </Form.Item>
          <Form.Item label="必须覆盖的要求" name="requiredClaims">
            <Input placeholder="地区，多语言，回滚" />
          </Form.Item>
        </div>
        <Button
          icon={<ExperimentOutlined />}
          loading={loading}
          onClick={() => void handleEval()}
          type="primary"
        >
          运行评测
        </Button>
      </Form>
      {evalResult && (
        <div className="agent-eval-result">
          <Alert
            showIcon
            title={evalResult.passed ? "评测通过" : "评测未通过"}
            type={evalResult.passed ? "success" : "error"}
          />
          <div className="agent-metric-grid">
            {Object.entries(evalResult.metrics).map(([key, value]) => (
              <div key={key}>
                <span>{METRIC_LABELS[key] ?? key}</span>
                <Progress
                  percent={Math.round(value * 100)}
                  size="small"
                  status={value >= 0.8 ? "success" : "exception"}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );

  const governancePanel = (
    <section className="agent-ops-panel">
      <Alert
        showIcon
        type="info"
        title="平台治理"
        description="管理当前项目的工作流版本、模型与工具能力，并用同一套检索链路定位召回、重排和引用问题。"
      />
      <Button
        icon={<ReloadOutlined />}
        loading={governanceLoading}
        onClick={() => void loadGovernance()}
        style={{ margin: "16px 0" }}
      >
        刷新治理数据
      </Button>
      <div className="agent-governance-grid">
        <Card title={`模型注册（${governanceModels.length}）`} size="small">
          <Table
            size="small"
            rowKey={(row) => row.id ?? `${row.provider}-${row.model}`}
            pagination={false}
            dataSource={governanceModels}
            columns={[
              { title: "提供方", dataIndex: "provider" },
              { title: "模型", dataIndex: "model" },
              { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> },
              { title: "降级模型", dataIndex: "fallbackModel", render: (value) => value || "-" },
            ]}
          />
        </Card>
        <Card className="agent-governance-plugin-card" title={`工具／插件注册（${governancePlugins.length}）`} size="small">
          <Alert
            showIcon
            type="info"
            style={{ marginBottom: 12 }}
            description="插件是声明式能力包：只能组合已在 Tool Registry 注册的工具，不支持上传并执行任意代码。工作流启动时会把选中的插件和有效工具写入运行审计。"
          />
          <div className="agent-governance-table-wrap">
            <Table
              size="small"
              rowKey={(row) => row.id ?? row.key}
              pagination={false}
              scroll={{ x: 820 }}
              dataSource={governancePlugins}
              columns={[
                { title: "标识", dataIndex: "key", width: 190 },
                { title: "类型", dataIndex: "type", width: 100 },
                { title: "版本", dataIndex: "version", width: 90 },
                { title: "状态", dataIndex: "status", width: 90, render: (value) => <Tag>{value}</Tag> },
                { title: "工具", dataIndex: "tools", width: 360, render: (value) => <span className="agent-governance-tools">{(value ?? []).join("、") || "-"}</span> },
                {
                  title: "操作",
                  width: 90,
                  render: (_, row) => <Button size="small" disabled={row.builtin} onClick={() => void handleTogglePlugin(row)}>{row.status === "enabled" ? "停用" : "启用"}</Button>,
                },
              ]}
            />
          </div>
          <Form form={pluginForm} layout="vertical" style={{ marginTop: 16 }}>
            <div className="agent-ops-form-grid">
              <Form.Item label="插件 Key" name="key" rules={[{ required: true, message: "例如 workflow.partner-review" }]}>
                <Input placeholder="workflow.partner-review" />
              </Form.Item>
              <Form.Item label="显示名称" name="displayName" rules={[{ required: true }]}>
                <Input placeholder="合作方审查能力包" />
              </Form.Item>
              <Form.Item label="类型" name="type" initialValue="tool">
                <Select options={["tool", "mcp", "datasource", "agent_strategy", "trigger"].map((value) => ({ value, label: value }))} />
              </Form.Item>
              <Form.Item label="版本" name="version" initialValue="1.0.0">
                <Input />
              </Form.Item>
            </div>
            <Form.Item label="已注册工具（英文逗号分隔）" name="tools">
              <Input placeholder="product_knowledge_search, artifact_generate" />
            </Form.Item>
            <div className="agent-ops-form-grid">
              <Form.Item label="适用链路" name="modes" initialValue={["production"]}>
                <Select mode="multiple" options={["simple", "auto", "agentic", "production"].map((value) => ({ value, label: value }))} />
              </Form.Item>
              <Form.Item label="说明" name="description">
                <Input placeholder="该能力包解决什么问题" />
              </Form.Item>
            </div>
            <Button type="primary" onClick={() => void handleRegisterPlugin()}>登记插件</Button>
          </Form>
        </Card>
      </div>
      <Card title="工作流版本与回滚" size="small" style={{ marginTop: 16 }}>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={governanceWorkflows}
          columns={[
            { title: "工作流", dataIndex: "name" },
            { title: "Key", dataIndex: "key" },
            { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> },
              { title: "当前版本", dataIndex: "activeVersion", render: (value) => value || "-" },
              {
                title: "操作",
                render: (_, record) => <Button size="small" onClick={() => void handleCloneWorkflow(record)}>复制模板</Button>,
              },
          ]}
        />
      </Card>
      <Card title={`知识库配置（${knowledgeBaseProfiles.length}）`} size="small" style={{ marginTop: 16 }}>
        <Form form={knowledgeBaseForm} layout="inline" style={{ marginBottom: 16 }}>
          <Form.Item name="key" rules={[{ required: true, message: "请输入 Key" }]}>
            <Input placeholder="项目 Key 或文档类型" />
          </Form.Item>
          <Form.Item name="name" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="知识库名称" />
          </Form.Item>
          <Form.Item name="documentType" initialValue="general">
            <Select style={{ width: 130 }} options={["prd", "api", "design", "test", "config", "general"].map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item name="chunkSize" initialValue={500}>
            <InputNumber min={200} max={4000} addonBefore="Chunk" />
          </Form.Item>
          <Form.Item name="chunkOverlap" initialValue={50}>
            <InputNumber min={0} max={1000} addonBefore="Overlap" />
          </Form.Item>
          <Button type="primary" loading={governanceLoading} onClick={() => void handleRegisterKnowledgeBase()}>
            保存配置
          </Button>
        </Form>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={knowledgeBaseProfiles}
          columns={[
            { title: "配置", dataIndex: "name" },
            { title: "Key", dataIndex: "key" },
            { title: "文档类型", dataIndex: "documentType" },
            { title: "Chunk", render: (_, row) => `${row.chunkSize}／${row.chunkOverlap}` },
            { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> },
          ]}
        />
      </Card>
      <Card title="评测集（Bad Case 审核通过后沉淀）" size="small" style={{ marginTop: 16 }}>
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 5 }}
          dataSource={evaluationCases}
          columns={[
            { title: "问题", dataIndex: "query", ellipsis: true },
            { title: "期望答案", dataIndex: "expectedAnswer", ellipsis: true },
            { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> },
          ]}
        />
      </Card>
      <Card title="检索调试" size="small" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Select
            value={retrievalProfileKey}
            onChange={setRetrievalProfileKey}
            style={{ width: 180 }}
            options={knowledgeBaseProfiles.map((profile) => ({ value: profile.key, label: profile.name }))}
          />
          <Input
            value={retrievalQuery}
            onChange={(event) => setRetrievalQuery(event.target.value)}
            onPressEnter={() => {
              if (retrievalQuery.trim()) {
                void debugGovernanceRetrieval(retrievalQuery.trim(), undefined, retrievalProfileKey).then((result) =>
                  setRetrievalDebug(unwrapData<any>(result)),
                );
              }
            }}
            placeholder="输入问题，查看关键词、语义、图谱、融合和重排结果"
          />
          <Button
            type="primary"
            disabled={!retrievalQuery.trim()}
            onClick={() => {
              void debugGovernanceRetrieval(retrievalQuery.trim(), undefined, retrievalProfileKey).then((result) =>
                setRetrievalDebug(unwrapData<any>(result)),
              );
            }}
          >
            调试检索
          </Button>
        </div>
        {retrievalDebug && (
          <>
            <Descriptions
              column={3}
              style={{ marginTop: 16 }}
              items={[
                { key: "profile", label: "检索配置", children: retrievalDebug.profile?.name ?? "-" },
                { key: "count", label: "最终片段", children: retrievalDebug.count ?? 0 },
                { key: "time", label: "生成时间", children: retrievalDebug.generatedAt ?? "-" },
              ]}
            />
            <Collapse
              items={[
                { key: "diagnostics", label: "诊断信息（召回／融合／重排）", children: <pre>{JSON.stringify(retrievalDebug.diagnostics, null, 2)}</pre> },
                { key: "chunks", label: "最终证据片段", children: <pre>{JSON.stringify(retrievalDebug.chunks, null, 2)}</pre> },
              ]}
            />
          </>
        )}
      </Card>
    </section>
  );

  const runCenterPanel = (
    <section className="agent-ops-panel">
      <Alert
        showIcon
        type="info"
        title="Agent 运行中心"
        description="集中查看问答与产研运工作流的路由、状态、动作、重试和估算成本；产研运工作流以 production_workflow 路由显示，点击“运行详情”可回放岗位检索、交付物、审批与最终结果。"
      />
      <Button
        icon={<ReloadOutlined />}
        onClick={() => void loadRunCenter()}
        style={{ margin: "16px 0" }}
      >
        刷新运行记录
      </Button>
      <Table
        rowKey="id"
        dataSource={runCenter}
        pagination={{ pageSize: 10 }}
        expandable={{
          expandedRowRender: (record) => (
            <Descriptions
              size="small"
              column={3}
              items={[
                { key: "thread", label: "Thread", children: record.threadId || "-" },
                { key: "node", label: "当前节点", children: record.currentNode || "-" },
                { key: "max", label: "最大步数", children: record.maxSteps ?? "-" },
                { key: "approval", label: "审批标记", children: record.requiresApproval ? "需要审批" : "无需审批" },
                { key: "created", label: "开始时间", children: record.createdAt || "-" },
                { key: "finished", label: "结束时间", children: record.finishedAt || "-" },
                {
                  key: "summary",
                  label: "结果摘要",
                  span: 3,
                  children: record.resultSummary ? (
                    <div className="answer-card run-result-preview agent-run-center-summary">
                      <AssistantMarkdown content={String(record.resultSummary)} status="done" />
                    </div>
                  ) : record.errorMessage || "-",
                },
                {
                  key: "goal",
                  label: "目标状态",
                  span: 3,
                  children: record.goal ? (
                    <span className="agent-run-center-goal">
                      {record.goal.status}：{record.goal.objective}
                      {record.goal.reason ? `；${record.goal.reason}` : ""}
                    </span>
                  ) : "-",
                },
              ]}
            />
          ),
        }}
        columns={[
          { title: "运行 ID", dataIndex: "id", ellipsis: true },
          { title: "模式", dataIndex: "mode" },
          { title: "路由／来源", dataIndex: "route", render: (value) => value === "production_workflow" ? <Tag color="purple">产研运工作流</Tag> : value || "问答" },
          {
            title: "状态",
            dataIndex: "status",
            render: (value) => <Tag color={value === "completed" ? "success" : value === "failed" ? "error" : "processing"}>{value}</Tag>,
          },
          { title: "动作", dataIndex: "actionCount" },
          { title: "重试", dataIndex: "retryCount" },
          { title: "估算成本", dataIndex: "costUsd", render: (value) => `$${Number(value ?? 0).toFixed(4)}` },
          {
            title: "操作",
            render: (_, record) => (
              <span style={{ display: "inline-flex", gap: 8 }}>
                <Button size="small" onClick={() => history.push(`/agent-ops/run-center/${encodeURIComponent(record.id)}`)}>运行详情</Button>
                <Button
                  size="small"
                  disabled={record.status === "running"}
                  onClick={() =>
                    void retryAgentRunRecord(record.id)
                      .then(() => {
                        message.success("已创建重跑任务");
                        return loadRunCenter();
                      })
                      .catch(() => message.error("重跑失败，请检查 Redis 和模型服务"))
                  }
                >
                  局部重跑
                </Button>
              </span>
            ),
          },
        ]}
      />
    </section>
  );

  const collaborationPanel = (
    <section className="agent-ops-panel">
      <Alert showIcon type="info" title="多 Agent 协作编排" description="把角色 Prompt 固化为 SOP，把上下游交接固化为结构化消息，把 Artifact 依赖和冲突决策纳入同一条可回放链路。" />
      <Button icon={<ReloadOutlined />} loading={collaborationLoading} onClick={() => void loadCollaboration()} style={{ margin: "16px 0" }}>刷新协作数据</Button>
      <Card title={`Agent SOP（${collaborationSops.length}）`} size="small">
        <Table size="small" rowKey="key" pagination={false} dataSource={collaborationSops} columns={[
          { title: "角色", dataIndex: "role" }, { title: "SOP", dataIndex: "name" }, { title: "版本", dataIndex: "version" }, { title: "最大步数", dataIndex: "maxSteps" },
          { title: "输入契约", dataIndex: "inputContract", render: (value) => JSON.stringify(value) }, { title: "输出契约", dataIndex: "outputContract", render: (value) => JSON.stringify(value) },
        ]} />
      </Card>
      <Card title={`Task 看板（${agentTasks.length}）`} size="small" style={{ marginTop: 16 }}>
        <Table size="small" rowKey="id" pagination={{ pageSize: 8 }} dataSource={agentTasks} columns={[
          { title: "任务", dataIndex: "title" }, { title: "角色", dataIndex: "role" }, { title: "Process", dataIndex: "processType" },
          { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "completed" ? "success" : value === "waiting_approval" ? "warning" : value === "failed" ? "error" : "processing"}>{value}</Tag> },
          { title: "重试", dataIndex: "retryCount" }, { title: "产物", dataIndex: "outputArtifactId", render: (value) => value || "-" },
          { title: "操作", render: (_, record) => <Button size="small" disabled={record.status !== 'failed'} onClick={() => void retryAgentTask(record.id).then(() => { message.success("Task 已重新排队并触发执行"); return loadCollaboration(); }).catch(() => message.error("Task 重跑失败"))}>单任务重跑</Button> },
        ]} />
      </Card>
      <Card title="受控委派（Agent as Tool）" size="small" style={{ marginTop: 16 }}>
        <Form form={delegateForm} layout="inline">
          <Form.Item name="threadId" rules={[{ required: true, message: "请输入 Thread ID" }]}><Input placeholder="Thread ID" /></Form.Item>
          <Form.Item name="runId"><Input placeholder="Run ID（绑定委派预算，可选）" /></Form.Item>
          <Form.Item name="parentTaskId"><Input placeholder="父任务 ID（可选）" /></Form.Item>
          <Form.Item name="role" rules={[{ required: true, message: "请输入角色" }]}><Input placeholder="目标 Agent 角色" /></Form.Item>
          <Form.Item name="title" rules={[{ required: true, message: "请输入任务标题" }]}><Input placeholder="子任务标题" /></Form.Item>
          <Form.Item name="description" rules={[{ required: true, message: "请输入任务描述" }]}><Input placeholder="任务描述" /></Form.Item>
          <Button type="primary" onClick={() => void handleDelegateTask()}>委派子任务</Button>
        </Form>
      </Card>
      <Card title={`运行事件流（${runtimeEvents.length}）`} size="small" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <Select allowClear showSearch value={runtimeRunId} style={{ width: 420 }} placeholder="选择一次问答运行，仅回放该 Run 的事件" options={runCenter.map((run) => ({ value: run.id, label: `${run.mode}／${run.route || "未路由"}／${run.status} · ${run.id}` }))} onChange={(value) => setRuntimeRunId(value)} />
          <Button onClick={() => setRuntimeRunId(undefined)}>查看全部事件</Button>
        </div>
        <Descriptions size="small" bordered column={4} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="事件总数">{runtimeMetrics.total ?? 0}</Descriptions.Item>
          <Descriptions.Item label="工具调用">{runtimeMetrics.toolCalls ?? 0}</Descriptions.Item>
          <Descriptions.Item label="节点执行">{runtimeMetrics.nodeStarts ?? 0}</Descriptions.Item>
          <Descriptions.Item label="目标完成／阻塞">{`${runtimeMetrics.goalsCompleted ?? 0}／${runtimeMetrics.goalsBlocked ?? 0}`}</Descriptions.Item>
          <Descriptions.Item label="上下文压缩">{runtimeMetrics.compactions ?? 0}</Descriptions.Item>
          <Descriptions.Item label="授权拦截">{runtimeMetrics.policyDenied ?? 0}</Descriptions.Item>
          <Descriptions.Item label="委派次数">{runtimeMetrics.delegations ?? 0}</Descriptions.Item>
          <Descriptions.Item label="预算超限">{runtimeEvents.filter((item) => item.eventType === "budget.exceeded").length}</Descriptions.Item>
        </Descriptions>
        <Table size="small" rowKey="id" pagination={{ pageSize: 8 }} dataSource={runtimeEvents.slice().reverse()} expandable={{ expandedRowRender: (record) => <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(record.payload, null, 2)}</pre> }} columns={[
          { title: "序号", dataIndex: "sequence" }, { title: "事件", dataIndex: "eventType", render: (value) => <Tag color={String(value).includes("failed") || String(value).includes("blocked") || String(value).includes("denied") ? "error" : String(value).includes("completed") ? "success" : "processing"}>{value}</Tag> }, { title: "执行者", dataIndex: "actor" }, { title: "目标", dataIndex: "target", render: (value) => value || "-" }, { title: "时间", dataIndex: "createdAt" },
        ]} />
      </Card>
      <div className="agent-ops-form-grid" style={{ marginTop: 16 }}>
        <Card title={`结构化交接消息（${collaborationMessages.length}）`} size="small"><Table size="small" rowKey="id" pagination={{ pageSize: 5 }} dataSource={collaborationMessages} columns={[{ title: "来源", dataIndex: "fromRole" }, { title: "目标", dataIndex: "toRole" }, { title: "主题", dataIndex: "subject" }, { title: "类型", dataIndex: "messageType" }]} /></Card>
        <Card title={`Artifact 依赖（${artifactDependencies.length}）`} size="small"><Table size="small" rowKey="id" pagination={{ pageSize: 5 }} dataSource={artifactDependencies} columns={[{ title: "产物", dataIndex: "artifactId" }, { title: "依赖", dataIndex: "dependsOnArtifactId" }, { title: "关系", dataIndex: "relation" }]} /></Card>
      </div>
      <Card title="Decision Record（冲突与最终决策）" size="small" style={{ marginTop: 16 }}>
        <Form form={decisionForm} layout="inline" style={{ marginBottom: 16 }}>
          <Form.Item name="threadId" rules={[{ required: true, message: "请输入 Thread ID" }]}><Input placeholder="Thread ID" /></Form.Item>
          <Form.Item name="title" rules={[{ required: true, message: "请输入决策标题" }]}><Input placeholder="决策标题" /></Form.Item>
          <Form.Item name="conflicts"><Input.TextArea placeholder="冲突项，每行一条" autoSize={{ minRows: 1, maxRows: 3 }} /></Form.Item>
          <Form.Item name="options"><Input.TextArea placeholder="候选方案，每行一条" autoSize={{ minRows: 1, maxRows: 3 }} /></Form.Item>
          <Button type="primary" onClick={() => void handleCreateDecision()}>保存决策</Button>
        </Form>
        <Table size="small" rowKey="id" pagination={{ pageSize: 5 }} dataSource={decisionRecords} columns={[{ title: "标题", dataIndex: "title" }, { title: "Thread", dataIndex: "threadId" }, { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: "冲突", dataIndex: "conflicts", render: (value) => Array.isArray(value) ? value.join("；") || "-" : "-" }]} />
      </Card>
      <Card title="项目回放" size="small" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", gap: 8 }}><Select showSearch style={{ width: 360 }} placeholder="选择 Agentic 会话" options={runOptions.map((item) => ({ value: item.threadId, label: `${item.threadId} · ${item.mode}` }))} onChange={(value) => void Promise.all([getCollaborationReplay(value), getCollaborationConflicts(value)]).then(([replay, conflicts]) => { setCollaborationReplay(unwrapData<any>(replay)); setCollaborationConflicts(unwrapData<any[]>(conflicts) ?? []); }).catch(() => message.error("回放加载失败"))} /><Button icon={<ReloadOutlined />} onClick={() => void loadRunOptions()}>刷新会话</Button></div>
        {collaborationConflicts.length > 0 && <Alert style={{ marginTop: 16 }} showIcon type="warning" title={`检测到 ${collaborationConflicts.length} 个协作冲突`} description={<pre>{JSON.stringify(collaborationConflicts, null, 2)}</pre>} />}
        {collaborationReplay && <Collapse style={{ marginTop: 16 }} items={[{ key: "run", label: "运行与动作", children: <pre>{JSON.stringify({ run: collaborationReplay.run, actions: collaborationReplay.actions }, null, 2)}</pre> }, { key: "artifacts", label: "产物与依赖", children: <pre>{JSON.stringify({ artifacts: collaborationReplay.artifacts, dependencies: collaborationReplay.dependencies }, null, 2)}</pre> }, { key: "messages", label: "交接消息与决策", children: <pre>{JSON.stringify({ messages: collaborationReplay.messages, decisions: collaborationReplay.decisions }, null, 2)}</pre> }]} />}
      </Card>
    </section>
  );

  return (
    <ModulePage
      activeKey={
        history.location.pathname.endsWith("/bad-cases")
          ? "bad-cases"
          : history.location.pathname.endsWith("/schedules")
            ? "schedules"
          : history.location.pathname.endsWith("/run-center")
            ? "run-center"
          : history.location.pathname.endsWith("/collaboration")
            ? "collaboration"
          : history.location.pathname.endsWith("/evals")
            ? "evals"
          : history.location.pathname.endsWith("/traces")
            ? "traces"
            : history.location.pathname.endsWith("/artifacts")
              ? "artifacts"
              : history.location.pathname.endsWith("/governance")
                ? "governance"
              : "workspace"
      }
      navItems={agentOpsNav}
      title="Agent 运营"
    >
      <div className="agent-ops-page">
        <header>
          <h2>Agent 运行与质量控制</h2>
          <p>审批长流程、回灌已审核 Bad Case、执行单案例评测并查看调用轨迹。</p>
        </header>
        <Tabs
          activeKey={
            history.location.pathname.endsWith("/bad-cases")
              ? "bad-cases"
              : history.location.pathname.endsWith("/schedules")
                ? "schedules"
              : history.location.pathname.endsWith("/run-center")
                ? "run-center"
              : history.location.pathname.endsWith("/collaboration")
                ? "collaboration"
              : history.location.pathname.endsWith("/evals")
                ? "evals"
              : history.location.pathname.endsWith("/traces")
                  ? "traces"
                  : history.location.pathname.endsWith("/artifacts")
                    ? "artifacts"
                    : history.location.pathname.endsWith("/governance")
                      ? "governance"
                  : "workflow"
          }
          onChange={(key) => {
            const routes: Record<string, string> = {
              workflow: "/agent-ops",
              evals: "/agent-ops/evals",
              "bad-cases": "/agent-ops/bad-cases",
              schedules: "/agent-ops/schedules",
              "run-center": "/agent-ops/run-center",
              collaboration: "/agent-ops/collaboration",
              traces: "/agent-ops/traces",
              artifacts: "/agent-ops/artifacts",
              governance: "/agent-ops/governance",
            };
            history.push(routes[key] ?? "/agent-ops");
          }}
          items={[
            { key: "workflow", label: "产研运工作流", children: workflowPanel },
            { key: "schedules", label: "定时任务", children: <ScheduledAnalysisPanel /> },
            { key: "run-center", label: "运行中心", children: runCenterPanel },
            { key: "collaboration", label: "协作编排", children: collaborationPanel },
            { key: "evals", label: "Agent Evals", children: evalPanel },
            { key: "governance", label: "平台治理", children: governancePanel },
            {
              key: "bad-cases",
              label: `Bad Case（${badCases.length}）`,
              children: (
                <section className="agent-ops-panel">
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => void loadBadCases()}
                  >
                    刷新
                  </Button>
                  <Table
                    dataSource={badCases}
                    rowKey="id"
                    pagination={{ pageSize: 8 }}
                    columns={[
                      { title: "问题", dataIndex: "query", ellipsis: true },
                      {
                        title: "错误类型",
                        dataIndex: "errorType",
                        render: (value) => value || "-",
                      },
                      {
                        title: "状态",
                        dataIndex: "status",
                        render: (value) => <Tag>{value}</Tag>,
                      },
                      {
                        title: "回归集",
                        dataIndex: "includeInRegression",
                        render: (value) => (
                          <Tag color={value ? "green" : "default"}>
                            {value ? "已加入" : "未加入"}
                          </Tag>
                        ),
                      },
                      {
                        title: "知识层",
                        dataIndex: "knowledgeLayer",
                        render: (value) => (
                          <Tag color={value === "formal" ? "blue" : value === "correction" ? "orange" : "default"}>
                            {value === "formal" ? "正式知识" : value === "correction" ? "纠正层" : "未生效"}
                          </Tag>
                        ),
                      },
                      {
                        title: "晋升状态",
                        dataIndex: "promotionStatus",
                        render: (value, record) => (
                          <span>{value === "promoted" ? `已晋升${record.promotedDocId ? ` · ${record.promotedDocId.slice(0, 8)}` : ""}` : value === "pending" ? "待晋升" : value === "rejected" ? "已拒绝" : "未申请"}</span>
                        ),
                      },
                      {
                        title: "纠正答案",
                        dataIndex: "correctedAnswer",
                        ellipsis: true,
                        render: (value) => value || "-",
                      },
                      {
                        title: "操作",
                        render: (_, record) => (
                          <Button
                            size="small"
                            disabled={record.knowledgeLayer === "formal"}
                            title={record.knowledgeLayer === "formal" ? "已晋升内容请到文档管理中进行版本治理" : undefined}
                            onClick={() => {
                              setSelectedBadCase(record);
                              reviewForm.setFieldsValue({
                                status: "reviewed",
                                correctedAnswer: record.correctedAnswer,
                                includeInRegression: true,
                                promotionAction: "correction",
                                promotionSource: record.promotionSource,
                              });
                            }}
                          >
                            {record.knowledgeLayer === "formal" ? "已晋升" : "审核"}
                          </Button>
                        ),
                      },
                    ]}
                  />
                </section>
              ),
            },
            {
              key: "traces",
              label: "调用轨迹",
              children: (
                <section className="agent-ops-panel">
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => void loadTraces()}
                  >
                    刷新
                  </Button>
                  <Table
                    dataSource={traces}
                    rowKey="spanId"
                    pagination={{ pageSize: 10 }}
                    columns={[
                      {
                        title: "Trace ID",
                        dataIndex: "traceId",
                        ellipsis: true,
                      },
                      { title: "方法", dataIndex: "method", width: 90 },
                      { title: "路由", dataIndex: "route", ellipsis: true },
                      { title: "状态", dataIndex: "status", width: 90 },
                      {
                        title: "耗时",
                        dataIndex: "durationMs",
                        width: 110,
                        render: (value) => `${value} ms`,
                      },
                      {
                        title: "开始时间",
                        dataIndex: "startedAt",
                        render: (value) =>
                          new Date(value).toLocaleString("zh-CN"),
                      },
                    ]}
                  />
                </section>
              ),
            },
            {
              key: "artifacts",
              label: "Artifact 审计",
              children: (
                <section className="agent-ops-panel">
                  <Alert
                    showIcon
                    type="info"
                    title="查看一次 Agentic 运行在 Redis Checkpointer 中保存的结构化交接物"
                    description="页面会自动选择最近会话；优先使用下拉选择，手动输入 Thread ID 仅用于高级排障。"
                  />
                  <div className="agent-ops-form-grid">
                    <Select
                      allowClear
                      showSearch
                      loading={runOptionsLoading}
                      value={
                        runOptions.some(
                          (item) => item.threadId === artifactThreadId,
                        )
                          ? artifactThreadId
                          : undefined
                      }
                      onChange={(value) => {
                        setArtifactThreadId(value ?? "");
                        if (value) {
                          void getAgentRunArtifacts(value).then((result) =>
                            setRunSnapshot(
                              unwrapData<AgenticRunSnapshot>(result),
                            ),
                          );
                        } else {
                          setRunSnapshot(null);
                        }
                      }}
                      optionFilterProp="label"
                      options={runOptions.map((item) => ({
                        value: item.threadId,
                        label: `${item.title} · ${item.mode} · ${new Date(item.updatedAt).toLocaleString("zh-CN")}${item.checkpointAvailable ? " · 已保存 Checkpoint" : " · 无 Checkpoint"}`,
                      }))}
                      placeholder="选择最近 Agentic 会话"
                    />
                    <Button
                      icon={<ReloadOutlined />}
                      loading={runOptionsLoading}
                      onClick={() => void loadRunOptions()}
                    >
                      刷新会话列表
                    </Button>
                    <Input
                      value={artifactThreadId}
                      onChange={(event) => setArtifactThreadId(event.target.value)}
                      onPressEnter={() => void loadRunArtifacts()}
                      placeholder="例如：ad8543e1-14ef-420c-a184-57595d6d01bc"
                    />
                    <Button
                      icon={<ReloadOutlined />}
                      loading={artifactLoading}
                      onClick={() => void loadRunArtifacts()}
                      type="primary"
                    >
                      查询运行状态
                    </Button>
                  </div>
                  {!runOptionsLoading && runOptions.length === 0 && (
                    <Alert
                      showIcon
                      type="warning"
                      title="暂时没有可审计的 Agentic 会话"
                      description="请先在 AI 智能问答中选择 Agentic 模式完成一次提问，再点击“刷新会话列表”。如果仍为空，请检查当前登录状态和 Agent Backend 服务。"
                    />
                  )}
                  {runSnapshot && (
                    <div className="agent-artifact-audit">
                      {!runSnapshot.available ? (
                        <Alert
                          showIcon
                          type={runSnapshot.artifacts.length > 0 ? "info" : "warning"}
                          title={runSnapshot.artifacts.length > 0 ? "Checkpoint 已过期，已加载持久化交接物" : "未找到该 Thread 的 Checkpoint"}
                          description={runSnapshot.artifacts.length > 0 ? "Redis Checkpoint 可能已过 TTL，以下内容来自 PostgreSQL 持久化记录，仍可用于审计和交接。" : "可能已过 Redis TTL，或该会话尚未进入 Agentic LangGraph 流程。"}
                        />
                      ) : (
                        <>
                          <Descriptions
                            column={2}
                            items={[
                              { key: "thread", label: "Thread", children: runSnapshot.threadId },
                              { key: "checkpoint", label: "Checkpoint", children: runSnapshot.checkpointId },
                              { key: "route", label: "路由", children: runSnapshot.route ?? "-" },
                              {
                                key: "sufficient",
                                label: "检索充分",
                                children: runSnapshot.retrievalSufficient === null
                                  ? "-"
                                  : runSnapshot.retrievalSufficient ? "是" : "否",
                              },
                              { key: "retry", label: "重试次数", children: runSnapshot.retryCount ?? "-" },
                              { key: "passed", label: "契约通过", children: runSnapshot.passed === null ? "-" : runSnapshot.passed ? "是" : "否" },
                            ]}
                          />
                          <Button
                            loading={artifactLoading}
                            onClick={() => void handleRetryRun()}
                            style={{ marginBottom: 16 }}
                          >
                            重新执行 Agentic 链路
                          </Button>
                          {runSnapshot.retrievalReason && (
                            <Alert type="warning" showIcon title="检索结论" description={runSnapshot.retrievalReason} />
                          )}
                          <h3>子问题计划与证据状态</h3>
                          <Table
                            rowKey={(record, index) => String(record.id ?? index)}
                            pagination={false}
                            dataSource={runSnapshot.subQuestions}
                            columns={[
                              { title: "子问题", dataIndex: "question", ellipsis: true },
                              { title: "状态", dataIndex: "status", render: (value) => <Tag>{String(value ?? "-")}</Tag> },
                              { title: "证据数", dataIndex: "evidenceIds", render: (value) => Array.isArray(value) ? value.length : 0 },
                              { title: "检索次数", dataIndex: "retrievalAttempts" },
                            ]}
                          />
                        </>
                      )}
                      {runSnapshot.artifacts.length > 0 && (
                        <>
                          <h3>Artifact 交接物</h3>
                          <Collapse
                            items={runSnapshot.artifacts.map((artifact) => ({
                              key: artifact.id,
                              label: `${ARTIFACT_LABELS[artifact.type] ?? artifact.type} · ${artifact.producer} · ${new Date(artifact.createdAt).toLocaleString("zh-CN")}`,
                              children: <pre>{JSON.stringify(artifact.payload, null, 2)}</pre>,
                            }))}
                          />
                        </>
                      )}
                    </div>
                  )}
                </section>
              ),
            },
          ]}
        />
      </div>
      <Modal
        open={Boolean(selectedBadCase)}
        title="审核 Bad Case"
        okText="保存并回灌"
        confirmLoading={loading}
        onCancel={() => setSelectedBadCase(null)}
        onOk={() => void handleReview()}
      >
        <Form form={reviewForm} layout="vertical">
          <Form.Item
            label="审核状态"
            name="status"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "reviewed", label: "审核通过" },
                { value: "resolved", label: "已解决" },
                { value: "ignored", label: "忽略" },
              ]}
            />
          </Form.Item>
          <Form.Item label="知识处理方式" name="promotionAction" initialValue="correction">
            <Select
              options={[
                { value: "correction", label: "保留在纠正知识层（默认，可撤销）" },
                { value: "request", label: "标记待晋升（暂不写入正式知识）" },
                { value: "promote", label: "晋升正式知识（需已核验来源）" },
                { value: "reject", label: "拒绝晋升申请" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="正式来源／规范地址"
            name="promotionSource"
            dependencies={["promotionAction"]}
            extra="仅在“晋升正式知识”时必填。来源会写入新正式文档，不能用用户修正答案替代来源。"
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (getFieldValue("promotionAction") !== "promote" || value?.trim()) return Promise.resolve();
                  return Promise.reject(new Error("晋升正式知识必须填写已核验来源或规范文档地址"));
                },
              }),
            ]}
          >
            <Input placeholder="https://… 或内部规范文档 ID" />
          </Form.Item>
          <Form.Item label="正式知识版本（可选）" name="promotionVersion" extra="不填时系统按 Bad Case 编号生成版本号。">
            <Input placeholder="例如 2026-08-v2" />
          </Form.Item>
          <Form.Item
            label="纠正答案"
            name="correctedAnswer"
            dependencies={["status"]}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (getFieldValue("status") === "ignored" || value?.trim()) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error("审核通过或解决时必须填写纠正答案"));
                },
              }),
            ]}
          >
            <Input.TextArea rows={6} />
          </Form.Item>
          <Form.Item
            label="进入回归集"
            name="includeInRegression"
            valuePropName="checked"
          >
            <Switch checkedChildren="是" unCheckedChildren="否" />
          </Form.Item>
        </Form>
      </Modal>
    </ModulePage>
  );
}
