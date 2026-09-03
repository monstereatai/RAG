import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import { AssistantMarkdown } from "@/components/AssistantMarkdown";
import { ModulePage, agentOpsNav } from "@/components/AdminShell";
import { history, useParams } from "@umijs/max";
import { Alert, Button, Card, Collapse, Descriptions, Result, Spin, Table, Tag, message } from "antd";
import React from "react";
import { getAgentRunDetail, getAgentRunDetailArtifacts, retryAgentRunRecord, unwrapData } from "../service";

const EVENT_LABELS: Record<string, string> = {
  "run.started": "运行开始",
  "request.snapshot": "请求快照",
  "agent.plan.created": "Runtime 计划",
  "skill.selected": "Skill 选择",
  "context.policy.selected": "上下文策略",
  "memory.context.loaded": "上下文加载",
  "route.selected": "路由选择",
  "retrieval.completed": "检索完成",
  "tool.call": "工具调用",
  "tool.called": "工具调用",
  "tool.result": "工具结果",
  "tool.failed": "工具失败",
  "tool.blocked": "工具拦截",
  "approval.asked": "请求审批",
  "approval.decided": "审批决定",
  "approval.required": "需要审批",
  "node.started": "节点开始",
  "node.completed": "节点完成",
  "node.failed": "节点失败",
  "run.retry": "运行重试",
  "run.completed": "运行完成",
  "run.failed": "运行失败",
  "goal.completed": "目标完成",
  "goal.blocked": "目标阻塞",
  "artifact.published": "产物发布",
  "agent.loop.started": "Agent Loop 开始",
  "agent.loop.round.started": "Loop 轮次开始",
  "agent.loop.model.started": "模型决策开始",
  "agent.loop.model.completed": "模型决策完成",
  "agent.loop.checkpoint.saved": "Loop 快照保存",
  "agent.loop.checkpoint.skipped": "Loop 快照跳过",
  "agent.loop.round.completed": "Loop 轮次完成",
  "agent.loop.completed": "Agent Loop 完成",
  "agent.loop.blocked": "Agent Loop 阻断",
  "agent.loop.failed": "Agent Loop 失败",
  "agent.loop.budget_exceeded": "Loop 预算超限",
};

const tagColor = (eventType: string) => {
  if (/failed|blocked|denied|exceeded/.test(eventType)) return "error";
  if (/completed|result|decided|published/.test(eventType)) return "success";
  if (/approval|required|retry/.test(eventType)) return "warning";
  return "processing";
};

const formatJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

export default function AgentRunDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [run, setRun] = React.useState<any>(null);
  const [artifactSummary, setArtifactSummary] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [retrying, setRetrying] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const result = await getAgentRunDetail(decodeURIComponent(id));
      const detail = unwrapData<any>(result);
      if (!detail?.id) throw new Error("运行记录不存在");
      setRun(detail);
      try {
        const artifactResult = await getAgentRunDetailArtifacts(decodeURIComponent(id));
        setArtifactSummary(unwrapData<any>(artifactResult) ?? { files: [], structuredArtifacts: [] });
      } catch (artifactError) {
        setArtifactSummary({ files: [], structuredArtifacts: [] });
        message.warning(artifactError instanceof Error ? `关联 Artifact 加载失败：${artifactError.message}` : "关联 Artifact 加载失败");
      }
    } catch (error) {
      setRun(null);
      setArtifactSummary(null);
      message.error(error instanceof Error ? error.message : "运行详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    if (run?.status !== "running") return;
    const timer = window.setTimeout(() => void load(), 2_000);
    return () => window.clearTimeout(timer);
  }, [load, run?.status]);

  const retry = async () => {
    if (!run) return;
    setRetrying(true);
    try {
      await retryAgentRunRecord(run.id);
      message.success("已重新排队，正在刷新运行状态");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "局部重跑失败");
    } finally {
      setRetrying(false);
    }
  };

  const generatedArtifacts = artifactSummary?.files ?? [];
  const structuredArtifacts = artifactSummary?.structuredArtifacts ?? [];
  const artifactCount = generatedArtifacts.length + structuredArtifacts.length;
  const runtimePlanEvent = (run?.events ?? []).find((event: any) => event.eventType === "agent.plan.created");
  const runtimePlan = runtimePlanEvent?.payload;
  const failureOnset = run?.failureOnset;
  const loopEvents = (run?.events ?? []).filter((event: any) => String(event.eventType).startsWith("agent.loop."));
  const loopFinalEvent = [...loopEvents].reverse().find((event: any) => /agent\.loop\.(completed|blocked|failed|budget_exceeded)/.test(event.eventType));
  const scrollToArtifacts = () => {
    document.getElementById("run-artifacts")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const content = loading ? <Spin tip="正在加载运行详情" /> : !run ? (
    <Result status="404" title="运行记录不存在" extra={<Button onClick={() => history.push("/agent-ops/run-center")}>返回运行中心</Button>} />
  ) : (
    <>
      <Card
        title="运行总览"
        extra={<span><Button icon={<ArrowLeftOutlined />} onClick={() => history.push("/agent-ops/run-center")}>返回运行中心</Button><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()} style={{ marginLeft: 8 }}>刷新</Button><Button danger disabled={run.status === "running"} loading={retrying} onClick={() => void retry()} style={{ marginLeft: 8 }}>局部重跑</Button></span>}
      >
        <Descriptions bordered column={3} items={[
          { key: "id", label: "运行 ID", children: run.id },
          { key: "thread", label: "会话 Thread", children: run.threadId },
          { key: "status", label: "状态", children: <Tag color={run.status === "completed" ? "success" : run.status === "failed" ? "error" : "processing"}>{run.status}</Tag> },
          { key: "mode", label: "模式／路由", children: `${run.mode}／${run.route || "未路由"}` },
          { key: "budget", label: "步骤／工具预算", children: `${run.actionCount}/${run.maxSteps}；${run.toolCallCount}/${run.maxToolCalls}` },
          { key: "cost", label: "重试／估算成本", children: `${run.retryCount} 次／$${Number(run.costUsd ?? 0).toFixed(4)}` },
          { key: "artifacts", label: "关联 Artifact", children: `${artifactCount} 个` },
          { key: "goal", label: "目标状态", span: 3, children: run.goal ? `${run.goal.status}：${run.goal.objective}${run.goal.reason ? `；${run.goal.reason}` : ""}` : "未记录" },
          { key: "summary", label: "结果预览", span: 3, children: run.resultSummary ? <div className="answer-card run-result-preview"><AssistantMarkdown content={run.resultSummary} status="done" /></div> : run.errorMessage || "运行中，尚未生成最终结果" },
          { key: "failure", label: "失败起点", span: 3, children: failureOnset?.found ? `${failureOnset.eventType}／序号 ${failureOnset.sequence ?? "-"}：${failureOnset.reason}；建议：${failureOnset.recommendation}` : "未发现明确失败起点" },
        ]} />
      </Card>

      <Card title="Agent Loop 执行摘要" style={{ marginTop: 16 }}>
        {loopEvents.length === 0 ? (
          <Alert showIcon type="info" title="本次运行未进入 Agent Loop" description="Simple 快速问答不使用循环；历史运行或在 Loop 接入前完成的记录也不会产生循环事件。" />
        ) : (
          <Descriptions bordered column={4} size="small" items={[
            { key: "starts", label: "循环实例", children: run.metrics?.loopStarts ?? 0 },
            { key: "rounds", label: "完成轮次", children: run.metrics?.loopRounds ?? 0 },
            { key: "checkpoints", label: "Redis 快照", children: loopEvents.filter((event: any) => event.eventType === "agent.loop.checkpoint.saved").length },
            { key: "status", label: "终止状态", children: loopFinalEvent ? <Tag color={tagColor(loopFinalEvent.eventType)}>{EVENT_LABELS[loopFinalEvent.eventType] ?? loopFinalEvent.eventType}</Tag> : "运行中" },
            { key: "reason", label: "终止原因", span: 4, children: loopFinalEvent?.payload?.terminationReason || "尚未产生终止事件" },
          ]} />
        )}
      </Card>

      <Card title="Agent Runtime 计划" style={{ marginTop: 16 }}>
        {!runtimePlan ? <Alert showIcon type="info" title="本次运行没有 Runtime 计划事件" description="历史运行可能早于 Runtime 控制层接入；新建问答或工作流后可查看计划、Skill 和上下文策略。" /> : (
          <>
            <Descriptions bordered column={3} size="small" items={[
              { key: "plan", label: "计划 ID", children: runtimePlan.planId },
              { key: "mode", label: "模式", children: runtimePlan.mode },
              { key: "skills", label: "已选 Skill", children: runtimePlan.selectedSkills?.join("、") || "未匹配" },
              { key: "context", label: "上下文策略", span: 3, children: `历史 ${runtimePlan.contextPolicy?.maxHistoryTurns ?? "-"} 轮；预算 ${runtimePlan.contextPolicy?.maxContextCharacters ?? "-"} 字符；压缩阈值 ${runtimePlan.contextPolicy?.compressionThreshold ?? "-"} 字符；Thread 隔离：${runtimePlan.contextPolicy?.isolatedByThread ? "是" : "否"}` },
            ]} />
            <Table rowKey="id" size="small" pagination={false} style={{ marginTop: 12 }} dataSource={runtimePlan.stages ?? []} columns={[
              { title: "阶段", dataIndex: "id" },
              { title: "角色", dataIndex: "role" },
              { title: "执行方式", dataIndex: "execution" },
              { title: "依赖", dataIndex: "dependsOn", render: (value) => value?.join("、") || "无" },
              { title: "说明", dataIndex: "description" },
            ]} />
          </>
        )}
      </Card>

      <Card title={`可审计事件时间线（${run.events?.length ?? 0}）`} style={{ marginTop: 16 }}>
        <Alert showIcon type="info" style={{ marginBottom: 16 }} title="从请求快照到最终结果的完整回放" description="展开事件可查看当时的结构化载荷。请求快照只保留 Prompt 版本、检索配置、记忆数量与工具策略，不保存原始敏感问题全文。" />
        <Table
          rowKey="id"
          size="small"
          pagination={{ pageSize: 12 }}
          dataSource={run.events ?? []}
          expandable={{ expandedRowRender: (record: any) => <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{formatJson(record.payload)}</pre> }}
          columns={[
            { title: "序号", dataIndex: "sequence", width: 70 },
            { title: "事件", dataIndex: "eventType", render: (value) => <Tag color={tagColor(String(value))}>{EVENT_LABELS[String(value)] ?? value}</Tag> },
            { title: "执行者", dataIndex: "actor", width: 130 },
            { title: "目标", dataIndex: "target", render: (value) => value || "-" },
            { title: "时间", dataIndex: "createdAt", width: 180, render: (value) => value ? new Date(value).toLocaleString("zh-CN") : "-" },
          ]}
        />
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16, marginTop: 16 }}>
        <Card title={`工具／动作审计（${run.actions?.length ?? 0}）`} size="small">
          <Table rowKey="id" size="small" pagination={{ pageSize: 6 }} dataSource={run.actions ?? []} expandable={{ expandedRowRender: (record: any) => <Collapse items={[{ key: "input", label: "输入", children: <pre>{record.input || "-"}</pre> }, { key: "output", label: "输出", children: <pre>{record.output || "-"}</pre> }]} /> }} columns={[
            { title: "动作", dataIndex: "name" },
            { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "success" ? "success" : value === "failed" ? "error" : "warning"}>{value}</Tag> },
            { title: "风险", dataIndex: "riskLevel" },
            { title: "耗时", dataIndex: "durationMs", render: (value) => `${value ?? 0} ms` },
          ]} />
        </Card>
        <Card title="运行指标与关联入口" size="small">
          <Descriptions column={2} size="small" items={[
            { key: "events", label: "事件", children: run.metrics?.total ?? 0 },
            { key: "snapshots", label: "请求快照", children: run.metrics?.requestSnapshots ?? 0 },
            { key: "tools", label: "工具成功／失败", children: `${run.metrics?.toolResults ?? 0}／${run.metrics?.toolFailures ?? 0}` },
            { key: "approval", label: "审批请求／决定", children: `${run.metrics?.approvalAsked ?? 0}／${run.metrics?.approvalDecided ?? 0}` },
          ]} />
          <Button type="primary" disabled={artifactCount === 0} style={{ marginTop: 16 }} onClick={scrollToArtifacts}>查看关联 Artifact</Button>
          <Button style={{ margin: "16px 0 0 8px" }} onClick={() => history.push(`/qa-ops?threadId=${encodeURIComponent(run.threadId)}`)}>查看原始会话</Button>
          {artifactCount === 0 ? <div style={{ color: "#8c8c8c", marginTop: 8 }}>本次运行未生成文件或结构化交接物；请执行产研运工作流或 Agentic 产物任务后再查看。</div> : null}
        </Card>
      </div>

      <Card id="run-artifacts" title={`关联 Artifact（${artifactCount}）`} style={{ marginTop: 16 }}>
        {artifactCount === 0 ? (
          <Alert showIcon type="info" title="本次 Run 没有可审计产物" description="当前记录只包含运行开始与完成事件，没有生成文件、结构化交接物或 Redis Checkpoint。这是历史运行数据的真实状态，不是页面加载失败。" />
        ) : (
          <Collapse items={[
            ...generatedArtifacts.map((artifact: any) => ({
              key: `file-${artifact.id}`,
              label: `文件产物：${artifact.title}（${artifact.kind}／${artifact.status}）`,
              children: artifact.sourceText ? <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{artifact.sourceText}</pre> : <Alert showIcon type="warning" title="文件内容不可预览" description={artifact.errorMessage || "该产物尚未生成完成或没有可预览的文本内容。"} />,
            })),
            ...structuredArtifacts.map((artifact: any) => ({
              key: `structured-${artifact.id}`,
              label: `结构化交接物：${artifact.type}（${artifact.producer}）`,
              children: <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{formatJson(artifact.payload)}</pre>,
            })),
          ]} />
        )}
      </Card>
    </>
  );

  return <ModulePage activeKey="run-center" navItems={agentOpsNav} title="Agent 运营"><div className="agent-ops-page"><header><h2>Agent 运行详情</h2><p>回放一次请求从上下文装配、检索、工具调用到最终结果的完整审计链路。</p></header>{content}</div></ModulePage>;
}
