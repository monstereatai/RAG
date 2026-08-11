import {
  CheckOutlined,
  CloseOutlined,
  ExperimentOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { ModulePage, agentOpsNav } from "@/components/AdminShell";
import { history } from "@umijs/max";
import {
  Alert,
  Button,
  Collapse,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  message,
} from "antd";
import React from "react";
import {
  type AgentBadCase,
  type AgenticRunSnapshot,
  type AgentEvalResult,
  type ProductionRole,
  type ProductionWorkflow,
  type TraceSnapshot,
  evaluateAgent,
  getAgentBadCases,
  getAgentRunArtifacts,
  getAgentTraces,
  getProductionWorkflow,
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

export default function AgentOpsPage() {
  const [workflowForm] = Form.useForm();
  const [evalForm] = Form.useForm();
  const [reviewForm] = Form.useForm();
  const [workflow, setWorkflow] = React.useState<ProductionWorkflow | null>(
    null,
  );
  const [evalResult, setEvalResult] = React.useState<AgentEvalResult | null>(
    null,
  );
  const [badCases, setBadCases] = React.useState<AgentBadCase[]>([]);
  const [traces, setTraces] = React.useState<TraceSnapshot[]>([]);
  const [runSnapshot, setRunSnapshot] =
    React.useState<AgenticRunSnapshot | null>(null);
  const [artifactThreadId, setArtifactThreadId] = React.useState("");
  const [artifactLoading, setArtifactLoading] = React.useState(false);
  const [selectedBadCase, setSelectedBadCase] =
    React.useState<AgentBadCase | null>(null);
  const [loading, setLoading] = React.useState(false);

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
    void Promise.all([loadBadCases(), loadTraces()]).catch(() => undefined);
  }, [loadBadCases, loadTraces]);

  React.useEffect(() => {
    if (workflow?.status !== "running") return;
    const timer = window.setTimeout(() => {
      void getProductionWorkflow(workflow.threadId)
        .then((result) => {
          const nextWorkflow = unwrapData<ProductionWorkflow>(result);
          setWorkflow(nextWorkflow);
          workflowForm.setFieldValue(
            "rerunRoles",
            nextWorkflow.pendingApprovalRoles,
          );
        })
        .catch(() => undefined);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [workflow, workflowForm]);

  const handleStartWorkflow = async () => {
    const values = await workflowForm.validateFields();
    setLoading(true);
    try {
      const result = await startProductionWorkflow(values);
      const nextWorkflow = unwrapData<ProductionWorkflow>(result);
      setWorkflow(nextWorkflow);
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
        </div>
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
        {workflow && (
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
                { key: "status", label: "状态", children: workflow.status },
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
                            <pre>{deliverable.markdown}</pre>
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

  return (
    <ModulePage
      activeKey={
        history.location.pathname.endsWith("/bad-cases")
          ? "bad-cases"
          : history.location.pathname.endsWith("/evals")
            ? "evals"
          : history.location.pathname.endsWith("/traces")
            ? "traces"
            : history.location.pathname.endsWith("/artifacts")
              ? "artifacts"
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
              : history.location.pathname.endsWith("/evals")
                ? "eval"
              : history.location.pathname.endsWith("/traces")
                  ? "traces"
                  : history.location.pathname.endsWith("/artifacts")
                    ? "artifacts"
                  : "workflow"
          }
          onChange={(key) => {
            const routes: Record<string, string> = {
              workflow: "/agent-ops",
              eval: "/agent-ops/evals",
              "bad-cases": "/agent-ops/bad-cases",
              traces: "/agent-ops/traces",
              artifacts: "/agent-ops/artifacts",
            };
            history.push(routes[key] ?? "/agent-ops");
          }}
          items={[
            { key: "workflow", label: "产研运工作流", children: workflowPanel },
            { key: "eval", label: "Agent Evals", children: evalPanel },
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
                            onClick={() => {
                              setSelectedBadCase(record);
                              reviewForm.setFieldsValue({
                                status: "reviewed",
                                correctedAnswer: record.correctedAnswer,
                                includeInRegression: true,
                              });
                            }}
                          >
                            审核
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
                    description="输入问答会话的 Thread ID，可展开子问题计划、证据包和答案契约；该页面只读，不直接修改运行状态。"
                  />
                  <div className="agent-ops-form-grid">
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
                  {runSnapshot && (
                    <div className="agent-artifact-audit">
                      {!runSnapshot.available ? (
                        <Alert
                          showIcon
                          type="warning"
                          title="未找到该 Thread 的 Checkpoint"
                          description="可能已过 Redis TTL，或该会话尚未进入 Agentic LangGraph 流程。"
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
                          <h3>Artifact 交接物</h3>
                          <Collapse
                            items={runSnapshot.artifacts.map((artifact) => ({
                              key: artifact.id,
                              label: `${artifact.type} · ${artifact.producer} · ${new Date(artifact.createdAt).toLocaleString("zh-CN")}`,
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
