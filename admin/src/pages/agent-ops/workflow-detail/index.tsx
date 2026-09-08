import {
  ArrowLeftOutlined,
  CheckOutlined,
  CloseOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { XMarkdown } from '@ant-design/x-markdown';
import { history, useParams } from '@umijs/max';
import {
  Button,
  Card,
  Collapse,
  Descriptions,
  Form,
  Input,
  message,
  Result,
  Select,
  Spin,
  Steps,
  Tag,
} from 'antd';
import React from 'react';
import { agentOpsNav, ModulePage } from '@/components/AdminShell';
import '@ant-design/x-markdown/es/XMarkdown/index.css';
import {
  downloadProductionWorkflowProjectZip,
  getProductionWorkflow,
  getProductionWorkflowCodingContext,
  type ProductionRole,
  type ProductionWorkflow,
  resumeProductionWorkflow,
  reviseProductionWorkflow,
  unwrapData,
} from '../service';

const ROLE_LABELS: Record<ProductionRole, string> = {
  product: '产品',
  design: '设计',
  frontend: '前端',
  backend: '后端',
  qa: '测试',
  operations: '运营',
};

const STATUS_LABELS: Record<ProductionWorkflow['status'], string> = {
  running: '运行中',
  pending_approval: '待审批',
  revision_required: '待修订',
  completed: '已完成',
  failed: '失败',
};

const normalizeMarkdown = (content: string) =>
  content
    .replace(/\r\n/g, '\n')
    .replace(/```([A-Za-z0-9_-]+)\s+(?=\S)/g, '```$1\n');

export default function ProductionWorkflowDetailPage() {
  const { threadId = '' } = useParams<{ threadId: string }>();
  const [form] = Form.useForm();
  const [workflow, setWorkflow] = React.useState<ProductionWorkflow | null>(
    null,
  );
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [generatingProject, setGeneratingProject] = React.useState(false);

  const loadDetail = React.useCallback(async () => {
    if (!threadId) return;
    setLoading(true);
    try {
      const result = await getProductionWorkflow(decodeURIComponent(threadId));
      const detail = unwrapData<ProductionWorkflow>(result);
      if (!detail?.threadId) throw new Error('工作流不存在');
      setWorkflow(detail);
      form.setFieldsValue({
        rerunRoles: detail.requiresRevision
          ? detail.rerunRoles
          : detail.pendingApprovalRoles,
        supplementalMaterials: detail.supplementalMaterials ?? '',
      });
    } catch {
      setWorkflow(null);
      message.error('工作流详情加载失败，请返回列表重试');
    } finally {
      setLoading(false);
    }
  }, [form, threadId]);

  React.useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  React.useEffect(() => {
    if (workflow?.status !== 'running') return;
    const timer = window.setTimeout(() => void loadDetail(), 2000);
    return () => window.clearTimeout(timer);
  }, [loadDetail, workflow]);

  const handleResume = async (approval: 'approved' | 'rejected') => {
    if (!workflow) return;
    const feedback = String(form.getFieldValue('feedback') ?? '').trim();
    if (approval === 'rejected' && !feedback) {
      message.error('驳回时必须填写具体修改意见');
      return;
    }
    setSubmitting(true);
    try {
      const result = await resumeProductionWorkflow(workflow.threadId, {
        approval,
        feedback,
        rerunRoles: form.getFieldValue('rerunRoles'),
      });
      setWorkflow(unwrapData<ProductionWorkflow>(result));
      form.resetFields(['feedback']);
      message.success(
        approval === 'approved'
          ? '已批准并继续执行'
          : '已驳回，工作流已暂停并进入待修订状态',
      );
    } catch {
      message.error('审批操作失败，请刷新后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevise = async () => {
    if (!workflow) return;
    setSubmitting(true);
    try {
      const result = await reviseProductionWorkflow(workflow.threadId, {
        rerunRoles: form.getFieldValue('rerunRoles'),
        supplementalMaterials: String(
          form.getFieldValue('supplementalMaterials') ?? '',
        ).trim(),
      });
      setWorkflow(unwrapData<ProductionWorkflow>(result));
      message.success('已按驳回意见生成新版本，完成后将重新进入审批');
    } catch {
      message.error('修订任务启动失败，请刷新后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const getDirectory = () => {
    const picker = (
      window as Window & { showDirectoryPicker?: () => Promise<any> }
    ).showDirectoryPicker;
    if (!picker) {
      throw new Error(
        '当前浏览器不支持目录选择，请使用 Chrome／Edge 打开管理后台',
      );
    }
    return picker();
  };

  const loadCodingContext = async () => {
    if (workflow?.status !== 'completed')
      throw new Error('只有已完成工作流可以导出');
    const result = await getProductionWorkflowCodingContext(workflow.threadId);
    const context = unwrapData<Record<string, unknown>>(result);
    if (!context) throw new Error('代码上下文为空');
    return context;
  };

  const buildHandoffFiles = (context: Record<string, unknown>) => {
    const files: Array<{ name: string; content: string }> = [
      {
        name: 'RAG_WORKFLOW_CONTEXT.json',
        content: `${JSON.stringify(context, null, 2)}\n`,
      },
      {
        name: 'README.md',
        content: `# ${workflow?.projectId ?? '产研运项目'} 产研运交接物\n\n本目录由已完成的产研运工作流导出，编码前请先阅读各阶段交付物。\n`,
      },
    ];
    const stages = Array.isArray(context.stages)
      ? (context.stages as Array<Record<string, unknown>>)
      : [];
    stages.forEach((stage) => {
      const role = String(stage.role ?? 'stage');
      const deliverables = Array.isArray(stage.deliverables)
        ? (stage.deliverables as Array<Record<string, unknown>>)
        : [];
      const lowCodeSchemas = Array.isArray(stage.lowCodeSchemas)
        ? stage.lowCodeSchemas
        : [];
      if (lowCodeSchemas.length > 0) {
        files.push({
          name: `schemas/${role}.json`,
          content: `${JSON.stringify(lowCodeSchemas, null, 2)}\n`,
        });
      }
      deliverables.forEach((deliverable, index) => {
        const title = String(
          deliverable.title ?? `${role}-${index + 1}`,
        ).replace(/[\\/:*?"<>|]/g, '-');
        files.push({
          name: `handoff/${role}/${String(index + 1).padStart(2, '0')}-${title}.md`,
          content: String(deliverable.markdown ?? ''),
        });
      });
    });
    return files;
  };

  const writeFiles = async (
    directory: any,
    files: Array<{ name: string; content: string }>,
  ) => {
    for (const file of files) {
      const parts = file.name.split('/');
      const filename = parts.pop();
      if (!filename) continue;
      let target = directory;
      for (const part of parts)
        target = await target.getDirectoryHandle(part, { create: true });
      const handle = await target.getFileHandle(filename, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file.content);
      await writable.close();
    }
  };

  const exportMarkdownDirectory = async () => {
    setExporting(true);
    try {
      const context = await loadCodingContext();
      const directory = await getDirectory();
      await writeFiles(directory, buildHandoffFiles(context));
      message.success('已将工作流交接物导出到所选代码目录');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      message.error(
        error instanceof Error ? error.message : '导出 Markdown 交接物失败',
      );
    } finally {
      setExporting(false);
    }
  };

  const generateRunnableProject = async () => {
    if (!workflow) return;
    setGeneratingProject(true);
    const currentWorkflow = workflow;
    try {
      const response = await downloadProductionWorkflowProjectZip(
        currentWorkflow.threadId,
      );
      if (!response.ok) {
        const body = await response.text();
        let detail = body;
        try {
          const parsed = JSON.parse(body) as {
            message?: string | string[];
            error?: string;
          };
          detail = Array.isArray(parsed.message)
            ? parsed.message.join('；')
            : (parsed.message ?? parsed.error ?? body);
        } catch {
          // 保留非 JSON 的网关错误文本。
        }
        throw new Error(
          `项目 ZIP 生成失败（HTTP ${response.status}）：${detail || '服务端未返回错误详情'}`,
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${currentWorkflow.projectId}-project.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      message.success('项目 ZIP 已下载，解压后按 README 启动');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      message.error(
        error instanceof Error ? error.message : '生成可运行项目代码失败',
      );
    } finally {
      setGeneratingProject(false);
    }
  };

  const detailContent = loading ? (
    <Spin tip="正在加载工作流详情" />
  ) : !workflow ? (
    <Result
      status="404"
      title="工作流不存在"
      subTitle="该 Thread 可能已过期或当前账号无权访问。"
      extra={
        <Button onClick={() => history.push('/agent-ops')}>
          返回工作流列表
        </Button>
      }
    />
  ) : (
    <>
      <Card
        title={`${workflow.projectId}／工作流详情`}
        extra={
          <span>
            <SpaceButtons
              onBack={() => history.push('/agent-ops')}
              onRefresh={() => void loadDetail()}
              loading={loading}
            />
            {workflow.status === 'completed' && (
              <>
                <Button
                  icon={<ExportOutlined />}
                  loading={exporting}
                  onClick={() => void exportMarkdownDirectory()}
                  style={{ marginLeft: 8 }}
                >
                  导出 Markdown 交接物
                </Button>
                <Button
                  type="primary"
                  icon={<FolderOpenOutlined />}
                  loading={generatingProject}
                  onClick={() => void generateRunnableProject()}
                  style={{ marginLeft: 8 }}
                >
                  生成可运行项目代码
                </Button>
              </>
            )}
          </span>
        }
      >
        <Steps
          current={workflow.stageIndex}
          items={workflow.selectedRoles.map((role, index) => ({
            title: ROLE_LABELS[role],
            status:
              workflow.status === 'failed' && index === workflow.stageIndex
                ? 'error'
                : workflow.completedRoles.includes(role)
                  ? 'finish'
                  : workflow.currentBatch.includes(role)
                    ? 'process'
                    : 'wait',
          }))}
        />
        <Descriptions
          column={2}
          style={{ marginTop: 24 }}
          items={[
            {
              key: 'status',
              label: '状态',
              children: (
                <Tag
                  color={
                    workflow.status === 'completed'
                      ? 'green'
                      : workflow.status === 'failed'
                        ? 'red'
                        : workflow.status === 'pending_approval' ||
                            workflow.status === 'revision_required'
                          ? 'orange'
                          : 'blue'
                  }
                >
                  {STATUS_LABELS[workflow.status]}
                </Tag>
              ),
            },
            {
              key: 'steps',
              label: '执行步数',
              children: `${workflow.stepCount}/${workflow.maxSteps}`,
            },
            { key: 'thread', label: 'Thread ID', children: workflow.threadId },
            {
              key: 'batch',
              label: '当前批次',
              children:
                workflow.currentBatch
                  .map((role) => ROLE_LABELS[role])
                  .join('＋') || '已完成',
            },
            {
              key: 'approval',
              label: '审批策略',
              children: workflow.approvalMode,
            },
            {
              key: 'error',
              label: '错误信息',
              children: workflow.error || '无',
            },
          ]}
        />
      </Card>

      <Card title="阶段产物" style={{ marginTop: 16 }}>
        <Collapse
          items={workflow.selectedRoles
            .filter((role) => workflow.results[role])
            .map((role) => {
              const result = workflow.results[role];
              if (!result) return null;
              return {
                key: role,
                label: (
                  <span>
                    {ROLE_LABELS[role]}：{result.summary}{' '}
                    <Tag>v{result.revision ?? 1}</Tag>
                    <Tag
                      color={
                        result.reviewStatus === 'approved'
                          ? 'green'
                          : result.reviewStatus === 'rejected'
                            ? 'red'
                            : result.reviewStatus === 'stale'
                              ? 'orange'
                              : 'blue'
                      }
                    >
                      {result.reviewStatus ?? 'pending'}
                    </Tag>
                    <Tag
                      color={
                        result.riskLevel === 'high'
                          ? 'red'
                          : result.riskLevel === 'medium'
                            ? 'orange'
                            : 'green'
                      }
                    >
                      风险：{result.riskLevel}
                    </Tag>
                    <Tag
                      color={result.evidenceCoverage === 1 ? 'green' : 'orange'}
                    >
                      证据覆盖：{Math.round(result.evidenceCoverage * 100)}%
                    </Tag>
                  </span>
                ),
                children: (
                  <div className="agent-stage-output">
                    {result.deliverables.map((deliverable) => (
                      <section key={`${deliverable.type}-${deliverable.title}`}>
                        <strong>{deliverable.title}</strong>
                        <XMarkdown
                          content={normalizeMarkdown(deliverable.markdown)}
                          escapeRawHtml
                          openLinksInNewTab
                          paragraphTag="div"
                        />
                      </section>
                    ))}
                    {Array.isArray(result.lowCodeSchemas) &&
                      result.lowCodeSchemas.length > 0 && (
                        <section>
                          <strong>低代码 / AI Coding Schema</strong>
                          <pre
                            style={{
                              maxHeight: 360,
                              overflow: 'auto',
                              background: '#f8fafc',
                              border: '1px solid #eaecf0',
                              borderRadius: 8,
                              padding: 12,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {JSON.stringify(result.lowCodeSchemas, null, 2)}
                          </pre>
                        </section>
                      )}
                    <p>问题：{result.issues.join('；') || '无'}</p>
                    <p>下游风险：{result.downstreamRisks.join('；') || '无'}</p>
                  </div>
                ),
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)}
        />
      </Card>

      {workflow.requiresApproval && (
        <Card title="审批操作" style={{ marginTop: 16 }}>
          <Form form={form} layout="vertical">
            <Form.Item name="feedback" label="审批意见">
              <Input.TextArea
                rows={3}
                placeholder="驳回时必须填写具体修改意见"
              />
            </Form.Item>
            <Form.Item name="rerunRoles" label="需要修订的岗位">
              <SelectRoles roles={workflow.currentBatch} />
            </Form.Item>
            <Button
              icon={<CheckOutlined />}
              type="primary"
              loading={submitting}
              onClick={() => void handleResume('approved')}
            >
              批准并继续
            </Button>
            <Button
              icon={<CloseOutlined />}
              danger
              loading={submitting}
              onClick={() => void handleResume('rejected')}
              style={{ marginLeft: 8 }}
            >
              驳回并要求修订
            </Button>
          </Form>
        </Card>
      )}
      {workflow.requiresRevision && (
        <Card
          title={`待修订：准备生成 v${workflow.revisionNumber ?? 2}`}
          style={{ marginTop: 16 }}
        >
          <Form form={form} layout="vertical">
            <p>
              <strong>驳回意见：</strong>
              {workflow.feedback}
            </p>
            <p>
              <strong>受影响下游：</strong>
              {(workflow.staleRoles ?? [])
                .map((role) => ROLE_LABELS[role])
                .join('、') || '无'}
            </p>
            <Form.Item
              name="rerunRoles"
              label="本次局部重试岗位"
              extra="只能从被驳回的岗位中选择；受影响下游会在修订版本审批通过后按依赖重新执行。"
            >
              <SelectRoles roles={workflow.rerunRoles} />
            </Form.Item>
            <Form.Item
              name="supplementalMaterials"
              label="补充缺失资料／已核验来源／业务约束"
              extra="可填写规则补充、接口字段、来源链接或验收约束。本次仅作为待核验修订上下文；要成为正式知识请另行走文档入库和审核。"
            >
              <Input.TextArea
                rows={6}
                maxLength={12000}
                showCount
                placeholder="例如：库存扣减以 reward_stock.remaining 为准；发奖失败须写入 compensation_queue；已核验来源：https://…"
              />
            </Form.Item>
            <Button
              type="primary"
              loading={submitting}
              onClick={() => void handleRevise()}
            >
              提交修订包并局部重试
            </Button>
          </Form>
        </Card>
      )}
      {(workflow.revisionHistory ?? []).length > 0 && (
        <Card title="产物版本历史" style={{ marginTop: 16 }}>
          <Collapse
            items={(workflow.revisionHistory ?? []).map((record) => ({
              key: String(record.revision),
              label: `v${record.revision} · 已驳回 · ${new Date(record.rejectedAt).toLocaleString()}`,
              children: (
                <div>
                  <p>
                    <strong>驳回意见：</strong>
                    {record.feedback}
                  </p>
                  <p>
                    <strong>驳回岗位：</strong>
                    {record.rejectedRoles
                      .map((role) => ROLE_LABELS[role])
                      .join('、')}
                  </p>
                  <p>
                    <strong>下游过期：</strong>
                    {record.staleRoles
                      .map((role) => ROLE_LABELS[role])
                      .join('、') || '无'}
                  </p>
                  {record.revisedAt && (
                    <>
                      <p>
                        <strong>局部重试：</strong>
                        {(record.rerunRoles ?? [])
                          .map((role) => ROLE_LABELS[role])
                          .join('、')}
                      </p>
                      <p>
                        <strong>补充资料：</strong>
                        {record.supplementalMaterials || '未补充'}
                      </p>
                    </>
                  )}
                </div>
              ),
            }))}
          />
        </Card>
      )}
    </>
  );

  return (
    <ModulePage activeKey="workspace" navItems={agentOpsNav} title="Agent 运营">
      <div className="agent-ops-page">
        <header>
          <h2>产研运工作流详情</h2>
          <p>查看一次工作流的状态、阶段产物、证据和审批记录。</p>
        </header>
        {detailContent}
      </div>
    </ModulePage>
  );
}

function SelectRoles({
  roles,
  value,
  onChange,
}: {
  roles: ProductionRole[];
  value?: ProductionRole[];
  onChange?: (value: ProductionRole[]) => void;
}) {
  return (
    <Select
      mode="multiple"
      value={value}
      onChange={onChange}
      options={roles.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
      placeholder="选择需要重跑的岗位"
    />
  );
}

function SpaceButtons({
  onBack,
  onRefresh,
  loading,
}: {
  onBack: () => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <span>
      <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
        返回列表
      </Button>
      <Button
        icon={<ReloadOutlined />}
        loading={loading}
        onClick={onRefresh}
        style={{ marginLeft: 8 }}
      >
        刷新
      </Button>
    </span>
  );
}
