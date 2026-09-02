import { AssistantMarkdown } from "@/components/AssistantMarkdown";
import {
  ClockCircleOutlined,
  FileMarkdownOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Upload,
  message,
} from "antd";
import React from "react";
import {
  type ParsedScheduledAnalysis,
  type ScheduledAnalysisConfig,
  type ScheduledAnalysisExecution,
  type ScheduledAnalysisJob,
  createScheduledAnalysisJob,
  copyScheduledAnalysisJob,
  getScheduledAnalysisVersions,
  getScheduledAnalysisExecutions,
  getScheduledAnalysisJobs,
  parseScheduledAnalysisJob,
  runScheduledAnalysisJob,
  startScheduledAnalysisJob,
  stopScheduledAnalysisJob,
  unwrapData,
} from "./service";

const DEFAULT_DEFINITION =
  "每天上午 9 点，统计今天新增或生效的规则、问答质量和负反馈，给产品、研发、测试、运营部门提出建议。";

const MONTHLY_TEMPLATE = `# 月度客户反馈复盘

每月 1 号上午 9 点执行。
统计本月负反馈、问答质量和产研运工作流数据。
给客服、产品、研发和运营部门输出问题分布、改进建议与待人工确认项。`;

type FormValues = ParsedScheduledAnalysis & { enabled: boolean };

const parseConfig = (raw: string): ScheduledAnalysisConfig => {
  try {
    return JSON.parse(raw) as ScheduledAnalysisConfig;
  } catch {
    return { window: "today", dataScopes: [], roles: [], departments: [] };
  }
};

const scheduleLabel = (job: ScheduledAnalysisJob) => {
  if (job.type === "cron") return `Cron：${job.cron ?? "-"}`;
  if (job.type === "every") return `每 ${Math.round((job.everyMs ?? 0) / 60_000)} 分钟`;
  return `单次：${job.at ? new Date(job.at).toLocaleString() : "-"}`;
};

export function ScheduledAnalysisPanel() {
  const [form] = Form.useForm<FormValues>();
  const [jobs, setJobs] = React.useState<ScheduledAnalysisJob[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [parsing, setParsing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [runningId, setRunningId] = React.useState<string>();
  const [executions, setExecutions] = React.useState<ScheduledAnalysisExecution[]>([]);
  const [historyJob, setHistoryJob] = React.useState<ScheduledAnalysisJob>();
  const [versionJob, setVersionJob] = React.useState<ScheduledAnalysisJob>();
  const [versions, setVersions] = React.useState<ScheduledAnalysisJob[]>([]);
  const sourceType = Form.useWatch("sourceType", form) ?? "natural_language";

  const loadJobs = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await getScheduledAnalysisJobs();
      setJobs(unwrapData<ScheduledAnalysisJob[]>(result) ?? []);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "定时任务加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    form.setFieldsValue({
      sourceType: "natural_language",
      instruction: DEFAULT_DEFINITION,
      enabled: true,
      type: "cron",
      analysisConfig: {
        window: "today",
        dataScopes: ["rules", "complaints", "qa", "workflow"],
        roles: [],
        departments: [],
      },
    });
    void loadJobs();
  }, [form, loadJobs]);

  const parseDefinition = async () => {
    const values = await form.validateFields(["sourceType", "instruction"]);
    setParsing(true);
    try {
      const result = await parseScheduledAnalysisJob({
        sourceText: values.instruction,
        sourceType: values.sourceType,
      });
      const parsed = unwrapData<ParsedScheduledAnalysis>(result);
      if (!parsed) throw new Error("任务定义解析结果为空");
      form.setFieldsValue({ ...parsed, enabled: form.getFieldValue("enabled") ?? true });
      message.success("已解析，请确认执行时间和数据范围后再创建");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "任务定义解析失败");
    } finally {
      setParsing(false);
    }
  };

  const createJob = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await createScheduledAnalysisJob({
        name: values.name,
        taskKind: "analysis",
        sourceType: values.sourceType,
        instruction: values.instruction,
        type: values.type,
        cron: values.type === "cron" ? values.cron : undefined,
        everyMs: values.type === "every" ? values.everyMs : undefined,
        at: values.type === "at" ? values.at : undefined,
        enabled: values.enabled,
        analysisConfig: values.analysisConfig,
      });
      message.success("定时任务已保存并进入调度器");
      await loadJobs();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "定时任务创建失败");
    } finally {
      setSaving(false);
    }
  };

  const runNow = async (job: ScheduledAnalysisJob) => {
    setRunningId(job.id);
    try {
      await runScheduledAnalysisJob(job.id);
      message.success("任务执行完成，报告已写入执行历史");
      await loadJobs();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "任务执行失败");
    } finally {
      setRunningId(undefined);
    }
  };

  const toggleJob = async (job: ScheduledAnalysisJob) => {
    try {
      if (job.enabled) await stopScheduledAnalysisJob(job.id);
      else await startScheduledAnalysisJob(job.id);
      await loadJobs();
      message.success(job.enabled ? "任务已停用" : "任务已启用");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "任务状态更新失败");
    }
  };

  const showHistory = async (job: ScheduledAnalysisJob) => {
    try {
      const result = await getScheduledAnalysisExecutions(job.id);
      setExecutions(unwrapData<ScheduledAnalysisExecution[]>(result) ?? []);
      setHistoryJob(job);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "执行历史加载失败");
    }
  };

  const copyJob = async (job: ScheduledAnalysisJob) => {
    try {
      const result = await copyScheduledAnalysisJob(job.id);
      const copied = unwrapData<ScheduledAnalysisJob>(result);
      message.success(`已复制为 v${copied?.version ?? (job.version ?? 1) + 1}，默认停用，确认后可启用`);
      await loadJobs();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "复制定时任务失败");
    }
  };

  const showVersions = async (job: ScheduledAnalysisJob) => {
    try {
      const result = await getScheduledAnalysisVersions(job.id);
      setVersions(unwrapData<ScheduledAnalysisJob[]>(result) ?? []);
      setVersionJob(job);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "版本历史加载失败");
    }
  };

  return (
    <section className="agent-ops-panel">
      <Alert
        showIcon
        type="info"
        title="用自然语言或 Markdown 创建可审计的 Agent 定时任务"
        description="系统先解析执行周期、数据范围和通知对象，必须由运营人员确认后才保存。当前“客户投诉”由问答负反馈代理，接入客服工单 API 后可替换为真实投诉数据。"
        style={{ marginBottom: 16 }}
      />
      <Card title="新建定时任务" size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Button onClick={() => form.setFieldsValue({ sourceType: "natural_language", instruction: DEFAULT_DEFINITION })}>
            每日规则与质量报告
          </Button>
          <Button onClick={() => form.setFieldsValue({ sourceType: "markdown", instruction: MONTHLY_TEMPLATE })}>
            月度反馈复盘
          </Button>
        </Space>
        <Form form={form} layout="vertical">
          <Form.Item name="sourceType" label="任务定义方式" rules={[{ required: true }]}>
            <Select options={[{ value: "natural_language", label: "自然语言" }, { value: "markdown", label: "Markdown 文档" }]} />
          </Form.Item>
          <Form.Item name="instruction" label="任务定义" rules={[{ required: true, message: "请输入任务内容或上传 Markdown" }]}>
            <Input.TextArea rows={sourceType === "markdown" ? 9 : 4} placeholder="例如：每天上午 9 点统计最新规则，并给产品和研发部门建议" />
          </Form.Item>
          <Upload
            accept=".md,text/markdown"
            maxCount={1}
            showUploadList={false}
            beforeUpload={async (file) => {
              form.setFieldsValue({ sourceType: "markdown", instruction: await file.text() });
              message.success(`已读取 ${file.name}，请点击“解析任务”`);
              return Upload.LIST_IGNORE;
            }}
          >
            <Button icon={<FileMarkdownOutlined />}>读取 Markdown</Button>
          </Upload>
          <Button type="primary" loading={parsing} onClick={() => void parseDefinition()} style={{ marginLeft: 8 }}>
            解析任务
          </Button>

          <Descriptions title="解析结果（保存前可修改）" bordered size="small" column={2} style={{ marginTop: 18 }}>
            <Descriptions.Item label="任务名称" span={2}>
              <Form.Item name="name" noStyle rules={[{ required: true, message: "请先解析或填写任务名称" }]}>
                <Input placeholder="任务名称" />
              </Form.Item>
            </Descriptions.Item>
            <Descriptions.Item label="调度类型">
              <Form.Item name="type" noStyle rules={[{ required: true }]}>
                <Select options={[{ value: "cron", label: "周期执行" }, { value: "every", label: "固定间隔" }, { value: "at", label: "单次执行" }]} />
              </Form.Item>
            </Descriptions.Item>
            <Descriptions.Item label="创建后启用">
              <Form.Item name="enabled" valuePropName="checked" noStyle><Switch /></Form.Item>
            </Descriptions.Item>
            <Descriptions.Item label="Cron（分 时 日 月 周）" span={2}>
              <Form.Item noStyle shouldUpdate={(previous, current) => previous.type !== current.type}>
                {({ getFieldValue }) => getFieldValue("type") === "cron" ? (
                  <Form.Item name="cron" noStyle rules={[{ required: true, message: "请输入 Cron" }]}><Input placeholder="0 9 * * *" /></Form.Item>
                ) : getFieldValue("type") === "every" ? (
                  <Form.Item name="everyMs" noStyle rules={[{ required: true, message: "请输入毫秒间隔" }]}><InputNumber min={1000} step={60_000} style={{ width: "100%" }} placeholder="3600000" /></Form.Item>
                ) : (
                  <Form.Item name="at" noStyle rules={[{ required: true, message: "请输入 ISO 时间" }]}><Input placeholder="2026-09-02T09:00:00+08:00" /></Form.Item>
                )}
              </Form.Item>
            </Descriptions.Item>
            <Descriptions.Item label="统计窗口">
              <Form.Item name={["analysisConfig", "window"]} noStyle>
                <Select options={[{ value: "today", label: "当天" }, { value: "week", label: "本周" }, { value: "month", label: "本月" }]} />
              </Form.Item>
            </Descriptions.Item>
            <Descriptions.Item label="数据范围">
              <Form.Item name={["analysisConfig", "dataScopes"]} noStyle>
                <Checkbox.Group options={[{ value: "rules", label: "规则文档" }, { value: "complaints", label: "负反馈代理" }, { value: "qa", label: "问答质量" }, { value: "workflow", label: "工作流" }]} />
              </Form.Item>
            </Descriptions.Item>
            <Descriptions.Item label="关注岗位">
              <Form.Item name={["analysisConfig", "roles"]} noStyle><Select mode="tags" tokenSeparators={["，", ","]} /></Form.Item>
            </Descriptions.Item>
            <Descriptions.Item label="关注部门">
              <Form.Item name={["analysisConfig", "departments"]} noStyle><Select mode="tags" tokenSeparators={["，", ","]} /></Form.Item>
            </Descriptions.Item>
          </Descriptions>
          <Button type="primary" icon={<ClockCircleOutlined />} loading={saving} onClick={() => void createJob()} style={{ marginTop: 16 }}>
            保存定时任务
          </Button>
        </Form>
      </Card>

      <Card
        title={`定时任务列表（${jobs.length}）`}
        size="small"
        style={{ marginTop: 16 }}
        extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadJobs()}>刷新</Button>}
      >
        <Table
          rowKey="id"
          loading={loading}
          dataSource={jobs}
          pagination={{ pageSize: 8 }}
          expandable={{
            expandedRowRender: (job) => (
              <div>
                <Descriptions size="small" column={2}>
                  <Descriptions.Item label="任务定义" span={2}>{job.instruction}</Descriptions.Item>
                  <Descriptions.Item label="数据范围">{parseConfig(job.analysisConfig).dataScopes.join("、") || "-"}</Descriptions.Item>
                  <Descriptions.Item label="关注部门">{parseConfig(job.analysisConfig).departments.join("、") || "-"}</Descriptions.Item>
                </Descriptions>
                {job.lastResult ? <Collapse items={[{ key: "report", label: "最近一次报告", children: <AssistantMarkdown content={job.lastResult} status="done" /> }]} /> : <Alert type="warning" showIcon title="尚未产生报告，可点击“立即执行”验证任务" />}
              </div>
            ),
          }}
          columns={[
            { title: "任务", dataIndex: "name", render: (value, job) => <><strong>{value || "未命名任务"}</strong><br /><small>{job.sourceType === "markdown" ? "Markdown" : "自然语言"}</small></> },
            { title: "版本", width: 90, render: (_, job) => <Space size={4}><Tag>v{job.version ?? 1}</Tag>{job.isCurrent !== false && <Tag color="blue">当前</Tag>}</Space> },
            { title: "周期", render: (_, job) => scheduleLabel(job) },
            { title: "状态", render: (_, job) => <Tag color={job.enabled ? "success" : "default"}>{job.enabled ? "已启用" : "已停用"}</Tag> },
            { title: "下次执行", dataIndex: "nextRunAt", render: (value) => value ? new Date(value).toLocaleString() : "-" },
            { title: "最近结果", render: (_, job) => job.lastError ? <Tag color="error">失败</Tag> : job.lastRun ? <Tag color="success">完成</Tag> : <Tag>未执行</Tag> },
            { title: "操作", width: 360, render: (_, job) => <Space wrap><Button size="small" icon={<PlayCircleOutlined />} loading={runningId === job.id} onClick={() => void runNow(job)}>立即执行</Button><Button size="small" onClick={() => void toggleJob(job)}>{job.enabled ? "停用" : "启用"}</Button><Button size="small" onClick={() => void copyJob(job)}>复制新版本</Button><Button size="small" onClick={() => void showVersions(job)}>版本历史</Button><Button size="small" onClick={() => void showHistory(job)}>执行历史</Button></Space> },
          ]}
        />
      </Card>

      <Modal title={`${historyJob?.name ?? "任务"}／执行历史`} open={Boolean(historyJob)} onCancel={() => setHistoryJob(undefined)} footer={null} width={960}>
        <Table
          rowKey="id"
          dataSource={executions}
          pagination={{ pageSize: 6 }}
          expandable={{ expandedRowRender: (record) => record.result ? <AssistantMarkdown content={record.result} status="done" /> : <Alert type="error" title={record.errorMessage ?? "没有报告"} /> }}
          columns={[
            { title: "开始时间", dataIndex: "startedAt", render: (value) => new Date(value).toLocaleString() },
            { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "completed" ? "success" : value === "failed" ? "error" : "processing"}>{value}</Tag> },
            { title: "耗时", dataIndex: "durationMs", render: (value) => value == null ? "-" : `${value} ms` },
            { title: "错误", dataIndex: "errorMessage", ellipsis: true, render: (value) => value || "-" },
          ]}
        />
      </Modal>
      <Modal title={`${versionJob?.name ?? "任务"}／版本历史`} open={Boolean(versionJob)} onCancel={() => setVersionJob(undefined)} footer={null} width={760}>
        <Alert type="info" showIcon title="复制只创建新版本，不会自动启用；启用某个版本后，其他版本会自动停用，历史执行记录保留。" style={{ marginBottom: 12 }} />
        <Table rowKey="id" dataSource={versions} pagination={false} columns={[
          { title: "版本", render: (_: unknown, item: ScheduledAnalysisJob) => `v${item.version ?? 1}` },
          { title: "状态", render: (_: unknown, item: ScheduledAnalysisJob) => <Tag color={item.enabled ? "success" : "default"}>{item.enabled ? "已启用" : "已停用"}</Tag> },
          { title: "创建时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
          { title: "操作", render: (_: unknown, item: ScheduledAnalysisJob) => <Button size="small" disabled={item.enabled} onClick={() => void toggleJob(item)}>启用此版本</Button> },
        ]} />
      </Modal>
    </section>
  );
}
