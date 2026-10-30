import {
  ArrowLeftOutlined,
  CheckOutlined,
  CloseOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  CloudSyncOutlined,
  CodeOutlined,
  DownloadOutlined,
  EyeOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import { XMarkdown } from '@ant-design/x-markdown';
import { history, useParams } from '@umijs/max';
import {
  Button,
  Card,
  Checkbox,
  Collapse,
  Descriptions,
  Form,
  Input,
  message,
  Modal,
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
  downloadProductionArtifact,
  createProductionWorkspacePreviewTicket,
  exportProductionWorkspace,
  getProductionArtifactPreview,
  getProductionArtifactSource,
  getProductionWorkflowArtifacts,
  getProductionWorkspaceStatus,
  getProductionActivityTemplates,
  getProductionComponentRules,
  getProductionPlaywayPreview,
  getProductionWorkflow,
  getProductionWorkflowHandoff,
  importProductionPlaywayGraph,
  applyProductionCodeEdit,
  applyProductionArtifactEdit,
  generateProductionWorkflowArtifacts,
  cancelProductionWorkflow,
  proposeProductionArtifactEdit,
  proposeProductionCodeEdit,
  deleteProductionWorkspace,
  runProductionWorkspaceAgent,
  runProductionWorkspaceCommand,
  restoreProductionArtifactVersion,
  startProductionWorkspace,
  startProductionWorkspaceDevServer,
  stopProductionWorkspaceDevServer,
  simulateProductionArtifactSync,
  type PlaywayActivityTemplate,
  type PlaywayComponentRule,
  type ProductionRole,
  type ProductionArtifactTarget,
  type ProductionArtifactVersion,
  type ProductionWorkspaceStatus,
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
  cancelled: '已取消',
};

const ARTIFACT_OPTIONS: Array<{
  value: ProductionArtifactTarget;
  label: string;
}> = [
  { value: 'activity-schema', label: '活动页 Schema JSON（内部结构）' },
  { value: 'vue-page', label: 'Vue 活动页代码' },
  { value: 'react-page', label: 'React 活动页代码' },
  { value: 'dashboard-schema', label: '数字大屏 Schema' },
  { value: 'vue-dashboard', label: 'Vue 数字大屏代码' },
  { value: 'react-dashboard', label: 'React 数字大屏代码' },
];

const artifactLabel = (target: unknown) =>
  ARTIFACT_OPTIONS.find((option) => option.value === target)?.label ??
  String(target ?? '未知产物');

interface ProductionArtifactEditDraft {
  target: 'activity-schema' | 'dashboard-schema';
  baseArtifactId: string;
  schema: Record<string, unknown>;
  diff: Array<{ path: string; before?: unknown; after?: unknown }>;
}

interface ProductionCodeEditDraft {
  baseArtifactId: string;
  instruction: string;
  target: Exclude<ProductionArtifactTarget, 'activity-schema' | 'dashboard-schema'>;
  framework: 'vue' | 'react';
  files: Record<string, string>;
  diff: Array<{ path: string; before: string; after: string }>;
  previewHtml: string;
}

interface ProductionWorkspaceAgentResult {
  status: 'completed' | 'failed';
  summary: string;
  steps?: Array<{ command: string; exitCode: number; output: string }>;
}

interface ProductionWorkspaceCommandResult {
  exitCode: number;
  output: string;
}

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
  const [componentRules, setComponentRules] = React.useState<
    PlaywayComponentRule[]
  >([]);
  const [componentQuery, setComponentQuery] = React.useState('');
  const [activityTemplates, setActivityTemplates] = React.useState<
    PlaywayActivityTemplate[]
  >([]);
  const [artifactTargets, setArtifactTargets] = React.useState<
    ProductionArtifactTarget[]
  >(['activity-schema']);
  const [artifactVersions, setArtifactVersions] = React.useState<
    ProductionArtifactVersion[]
  >([]);
  const [artifactBusy, setArtifactBusy] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<
    'activity-schema' | 'dashboard-schema'
  >('activity-schema');
  const [editBaseArtifactId, setEditBaseArtifactId] = React.useState('');
  const [editInstruction, setEditInstruction] = React.useState('');
  const [editDraft, setEditDraft] = React.useState<ProductionArtifactEditDraft | null>(null);
  const [editBusy, setEditBusy] = React.useState(false);
  const [codeEditBaseArtifactId, setCodeEditBaseArtifactId] = React.useState('');
  const [codeEditInstruction, setCodeEditInstruction] = React.useState('');
  const [codeEditDraft, setCodeEditDraft] = React.useState<ProductionCodeEditDraft | null>(null);
  const [codeEditBusy, setCodeEditBusy] = React.useState(false);
  const [workspaceStatus, setWorkspaceStatus] = React.useState<ProductionWorkspaceStatus | null>(null);
  const [workspaceArtifactId, setWorkspaceArtifactId] = React.useState('');
  const [workspaceBusy, setWorkspaceBusy] = React.useState(false);
  const [workspaceInstruction, setWorkspaceInstruction] = React.useState('');
  const [workspaceAgentResult, setWorkspaceAgentResult] = React.useState<ProductionWorkspaceAgentResult | null>(null);
  const [workspaceCommand, setWorkspaceCommand] = React.useState('');
  const [workspaceCommandResult, setWorkspaceCommandResult] = React.useState<ProductionWorkspaceCommandResult | null>(null);
  const [workspaceDevServerCommand, setWorkspaceDevServerCommand] = React.useState('npm run dev -- --host 0.0.0.0');
  const [workspacePort, setWorkspacePort] = React.useState('5173');
  const [workspacePreviewUrl, setWorkspacePreviewUrl] = React.useState('');
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewTitle, setPreviewTitle] = React.useState('产物预览');
  const [previewHtml, setPreviewHtml] = React.useState('');
  const [sourceOpen, setSourceOpen] = React.useState(false);
  const [sourceTitle, setSourceTitle] = React.useState('产物源文件');
  const [sourceFiles, setSourceFiles] = React.useState<Record<string, string>>({});
  const [sourceFile, setSourceFile] = React.useState('');

  const loadDetail = React.useCallback(async () => {
    if (!threadId) return;
    setLoading(true);
    try {
      const result = await getProductionWorkflow(decodeURIComponent(threadId));
      const detail = unwrapData<ProductionWorkflow>(result);
      if (!detail?.threadId) throw new Error('工作流不存在');
      setWorkflow(detail);
      // 项目 ID（例如 act9）不是 Playway 规则检索词。详情页首次进入应
      // 先展示默认组件规则和全部活动模板，用户再通过搜索框筛选玩法。
      const rules = await getProductionComponentRules('', 18);
      setComponentRules(rules.items ?? []);
      const templates = await getProductionActivityTemplates('', 4);
      setActivityTemplates(templates.items ?? []);
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

  const searchComponentRules = React.useCallback(async (query: string) => {
    setComponentQuery(query);
    const result = await getProductionComponentRules(query, 18);
    setComponentRules(result.items ?? []);
  }, []);

  React.useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  React.useEffect(() => {
    if (workflow?.status !== 'running') return;
    const timer = window.setTimeout(() => void loadDetail(), 2000);
    return () => window.clearTimeout(timer);
  }, [loadDetail, workflow]);

  React.useEffect(() => {
    if (workflow?.status !== 'completed') {
      setArtifactVersions([]);
      return;
    }
    let active = true;
    getProductionWorkflowArtifacts(workflow.threadId)
      .then((response) => {
        if (active) {
          setArtifactVersions(
            unwrapData<ProductionArtifactVersion[]>(response) ?? [],
          );
        }
      })
      .catch(() => {
        if (active) message.error('产物版本加载失败');
      });
    return () => {
      active = false;
    };
  }, [workflow?.threadId, workflow?.status]);

  React.useEffect(() => {
    if (!workflow?.threadId) {
      setWorkspaceStatus(null);
      return;
    }
    let active = true;
    getProductionWorkspaceStatus(workflow.threadId)
      .then((response) => {
        if (active) {
          setWorkspaceStatus(
            unwrapData<ProductionWorkspaceStatus>(response) ?? null,
          );
        }
      })
      .catch(() => {
        if (active) setWorkspaceStatus(null);
      });
    return () => {
      active = false;
    };
  }, [workflow?.threadId]);

  const refreshArtifactVersions = async () => {
    if (!workflow) return;
    const response = await getProductionWorkflowArtifacts(workflow.threadId);
    setArtifactVersions(
      unwrapData<ProductionArtifactVersion[]>(response) ?? [],
    );
  };

  const generateSelectedArtifacts = async () => {
    if (!workflow || artifactTargets.length === 0) {
      message.error('请至少选择一种产物');
      return;
    }
    setArtifactBusy(true);
    try {
      const response = await generateProductionWorkflowArtifacts(
        workflow.threadId,
        artifactTargets,
      );
      const result = unwrapData<{ items?: ProductionArtifactVersion[] }>(response);
      await refreshArtifactVersions();
      message.success(`已生成 ${result?.items?.length ?? 0} 个产物版本`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '产物生成失败');
    } finally {
      setArtifactBusy(false);
    }
  };

  const proposeArtifactEdit = async () => {
    if (!workflow || !editBaseArtifactId || !editInstruction.trim()) {
      message.error('请选择 Schema 版本并填写修改要求');
      return;
    }
    setEditBusy(true);
    setEditDraft(null);
    try {
      const response = await proposeProductionArtifactEdit(workflow.threadId, {
        target: editTarget,
        baseArtifactId: editBaseArtifactId,
        instruction: editInstruction.trim(),
      });
      const draft = unwrapData<ProductionArtifactEditDraft>(response);
      setEditDraft(draft);
      if (!draft.diff?.length) message.info('Schema 与当前版本相同，没有差异');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Schema 修改建议生成失败');
    } finally {
      setEditBusy(false);
    }
  };

  const applyArtifactEdit = async () => {
    if (!workflow || !editDraft) return;
    setEditBusy(true);
    try {
      await applyProductionArtifactEdit(workflow.threadId, {
        target: editDraft.target,
        baseArtifactId: editDraft.baseArtifactId,
        schema: editDraft.schema,
        regenerateTargets: artifactTargets.filter(
          (target) =>
            target !== 'activity-schema' && target !== 'dashboard-schema',
        ),
      });
      setEditDraft(null);
      setEditInstruction('');
      await refreshArtifactVersions();
      message.success('已保存新 Schema 版本');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '应用 Schema 修改失败');
    } finally {
      setEditBusy(false);
    }
  };

  const proposeCodeArtifactEdit = async () => {
    if (!workflow || !codeEditBaseArtifactId || !codeEditInstruction.trim()) {
      message.error('请选择代码版本并填写修改要求');
      return;
    }
    setCodeEditBusy(true);
    setCodeEditDraft(null);
    try {
      const response = await proposeProductionCodeEdit(workflow.threadId, {
        baseArtifactId: codeEditBaseArtifactId,
        instruction: codeEditInstruction.trim(),
      });
      const draft = unwrapData<ProductionCodeEditDraft>(response);
      setCodeEditDraft(draft);
      if (!draft.diff.length) message.info('代码没有变化');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '代码修改建议生成失败');
    } finally {
      setCodeEditBusy(false);
    }
  };

  const applyCodeArtifactEdit = async () => {
    if (!workflow || !codeEditDraft) return;
    setCodeEditBusy(true);
    try {
      const response = await applyProductionCodeEdit(workflow.threadId, {
        baseArtifactId: codeEditDraft.baseArtifactId,
        instruction: codeEditDraft.instruction,
        files: codeEditDraft.files,
      });
      const result = unwrapData<{
        artifact?: ProductionArtifactVersion;
        previewHtml?: string;
      }>(response);
      setCodeEditDraft(null);
      setCodeEditInstruction('');
      await refreshArtifactVersions();
      if (result?.previewHtml) {
        setPreviewTitle(result.artifact?.title ?? '代码修改预览');
        setPreviewHtml(result.previewHtml);
        setPreviewOpen(true);
      }
      message.success('已保存代码新版本；关联 Schema 保持原样');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '应用代码修改失败');
    } finally {
      setCodeEditBusy(false);
    }
  };

  const startWorkspace = async () => {
    if (!workflow || !workspaceArtifactId) {
      message.error('请选择要放入开发工作区的代码版本');
      return false;
    }
    setWorkspaceBusy(true);
    try {
      const response = await startProductionWorkspace(workflow.threadId, {
        artifactId: workspaceArtifactId,
      });
      const status = unwrapData<ProductionWorkspaceStatus>(response);
      if (!status?.ready) throw new Error('开发工作区尚未就绪');
      setWorkspaceStatus(status);
      message.success('开发工作区已就绪');
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '启动开发工作区失败');
      return false;
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const runWorkspaceAgent = async () => {
    if (!workflow || !workspaceArtifactId || !workspaceInstruction.trim()) {
      message.error('请选择代码版本并填写开发要求');
      return;
    }
    setWorkspaceBusy(true);
    setWorkspaceAgentResult(null);
    setWorkspaceCommandResult(null);
    try {
      if (!workspaceStatus?.ready) {
        const started = await startProductionWorkspace(workflow.threadId, {
          artifactId: workspaceArtifactId,
        });
        const status = unwrapData<ProductionWorkspaceStatus>(started);
        if (!status?.ready) throw new Error('开发工作区尚未就绪');
        setWorkspaceStatus(status);
      }
      const response = await runProductionWorkspaceAgent(workflow.threadId, {
        artifactId: workspaceArtifactId,
        instruction: workspaceInstruction.trim(),
      });
      const result = unwrapData<ProductionWorkspaceAgentResult>(response);
      if (!result) throw new Error('Agent 未返回执行结果');
      setWorkspaceAgentResult(result);
      try {
        const statusResponse = await getProductionWorkspaceStatus(workflow.threadId);
        const status = unwrapData<ProductionWorkspaceStatus>(statusResponse);
        if (status) setWorkspaceStatus(status);
      } catch {
        message.warning('Agent 结果已返回，但工作区状态刷新失败');
      }
      if (result.status === 'completed') {
        message.success('Agent 开发任务已完成');
      } else {
        message.warning(result.summary || 'Agent 开发任务未完成');
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Agent 开发任务失败');
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const runWorkspaceCommand = async () => {
    if (!workflow || !workspaceCommand.trim()) return;
    setWorkspaceBusy(true);
    setWorkspaceCommandResult(null);
    try {
      const response = await runProductionWorkspaceCommand(workflow.threadId, {
        command: workspaceCommand.trim(),
      });
      const result = unwrapData<ProductionWorkspaceCommandResult>(response);
      if (!result) throw new Error('命令没有返回执行结果');
      setWorkspaceCommandResult(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '执行命令失败');
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const startWorkspaceDevServer = async () => {
    if (!workflow || !workspaceStatus?.ready) {
      message.error('请先启动开发工作区');
      return;
    }
    const port = Number(workspacePort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      message.error('请输入 1–65535 之间的端口');
      return;
    }
    setWorkspaceBusy(true);
    try {
      const response = await startProductionWorkspaceDevServer(workflow.threadId, {
        port,
        command: workspaceDevServerCommand.trim() || undefined,
      });
      const result = unwrapData<{ port: number; commandId: string; status: string }>(response);
      if (!result) throw new Error('开发服务器没有返回状态');
      setWorkspaceStatus((current) => ({
        ready: true,
        projectRoot: current?.projectRoot ?? null,
        devServer: { port: result.port, commandId: result.commandId },
      }));
      setWorkspacePort(String(result.port));
      message.success(`开发服务器已启动（端口 ${result.port}）`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '启动开发服务器失败');
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const stopWorkspaceDevServer = async () => {
    if (!workflow) return;
    setWorkspaceBusy(true);
    try {
      await stopProductionWorkspaceDevServer(workflow.threadId);
      setWorkspaceStatus((current) =>
        current ? { ...current, devServer: undefined } : current,
      );
      setWorkspacePreviewUrl('');
      message.success('开发服务器已停止');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '停止开发服务器失败');
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const destroyWorkspace = () => {
    if (!workflow) return;
    Modal.confirm({
      title: '销毁开发工作区？',
      content: '未导出的修改会丢失。销毁后，若要继续开发，需要重新选择代码产物并启动工作区。',
      okText: '销毁工作区',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setWorkspaceBusy(true);
        try {
          await deleteProductionWorkspace(workflow.threadId, {
            confirmDiscard: true,
          });
          setWorkspacePreviewUrl('');
          setWorkspaceAgentResult(null);
          setWorkspaceCommandResult(null);
          try {
            const response = await getProductionWorkspaceStatus(workflow.threadId);
            setWorkspaceStatus(
              unwrapData<ProductionWorkspaceStatus>(response) ?? null,
            );
          } catch {
            setWorkspaceStatus(null);
          }
          message.success('工作区已销毁');
        } catch (error) {
          message.error(error instanceof Error ? error.message : '销毁工作区失败');
        } finally {
          setWorkspaceBusy(false);
        }
      },
    });
  };

  const openWorkspacePreview = async () => {
    if (!workflow || !workspaceStatus?.ready) {
      message.error('请先启动开发工作区');
      return;
    }
    const port = Number(workspacePort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      message.error('请输入 1–65535 之间的端口');
      return;
    }
    setWorkspaceBusy(true);
    try {
      const response = await createProductionWorkspacePreviewTicket(
        workflow.threadId,
        { port },
      );
      const result = unwrapData<{ url?: string }>(response);
      if (!result?.url?.startsWith('/api/')) {
        throw new Error('预览地址不是当前站点的受权代理地址');
      }
      setWorkspacePreviewUrl(result.url);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建开发预览失败');
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const exportWorkspace = async () => {
    if (!workflow || !workspaceStatus?.ready) {
      message.error('请先启动开发工作区');
      return;
    }
    setWorkspaceBusy(true);
    try {
      const response = await exportProductionWorkspace(workflow.threadId);
      const result = unwrapData<{ artifact?: ProductionArtifactVersion }>(response);
      if (!result?.artifact?.id) throw new Error('导出接口未返回 ZIP 产物');
      await refreshArtifactVersions();
      await downloadArtifact(result.artifact);
      message.success('工作区已保存为新 ZIP 版本');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出工作区失败');
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const previewArtifact = async (artifact: ProductionArtifactVersion) => {
    if (!workflow) return;
    try {
      const response = await getProductionArtifactPreview(
        workflow.threadId,
        artifact.id,
      );
      const result = unwrapData<{ html?: string }>(response);
      if (!result?.html) throw new Error('预览接口未返回 HTML 内容');
      setPreviewTitle(artifact.title);
      setPreviewHtml(result.html);
      setPreviewOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '产物预览失败');
    }
  };

  const viewArtifactSource = async (artifact: ProductionArtifactVersion) => {
    if (!workflow) return;
    try {
      const response = await getProductionArtifactSource(
        workflow.threadId,
        artifact.id,
      );
      const result = unwrapData<{ files?: Record<string, string> }>(response);
      const files = result?.files ?? {};
      const firstFile = Object.keys(files)[0];
      if (!firstFile) throw new Error('产物没有可查看的源文件');
      setSourceTitle(artifact.title);
      setSourceFiles(files);
      setSourceFile(firstFile);
      setSourceOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '源文件加载失败');
    }
  };

  const downloadArtifact = async (artifact: ProductionArtifactVersion) => {
    if (!workflow) return;
    try {
      const response = await downloadProductionArtifact(
        workflow.threadId,
        artifact.id,
      );
      if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = artifact.filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '产物下载失败');
    }
  };

  const simulateArtifactSync = async (artifact: ProductionArtifactVersion) => {
    if (!workflow) return;
    try {
      const response = await simulateProductionArtifactSync(
        workflow.threadId,
        artifact.id,
      );
      const result = unwrapData<{ objectId?: string; simulated?: boolean }>(response);
      await refreshArtifactVersions();
      message.success(`模拟同步完成：${result.objectId ?? '已生成模拟记录'}（未调用真实平台）`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模拟同步失败');
    }
  };

  const restoreArtifactVersion = async (artifact: ProductionArtifactVersion) => {
    if (!workflow) return;
    try {
      await restoreProductionArtifactVersion(workflow.threadId, artifact.id);
      await refreshArtifactVersions();
      message.success('已按该历史 Schema 创建新的当前版本');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '恢复 Schema 版本失败');
    }
  };

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

  const handleCancel = () => {
    if (!workflow) return;
    Modal.confirm({
      title: '取消这个工作流？',
      content: '正在执行的岗位会在当前步骤停止，已完成的产物会保留。',
      okText: '取消工作流',
      cancelText: '继续执行',
      okButtonProps: { danger: true },
      onOk: async () => {
        setSubmitting(true);
        try {
          const response = await cancelProductionWorkflow(
            workflow.threadId,
            '管理员在工作流详情页取消',
          );
          const updated = unwrapData<ProductionWorkflow>(response);
          if (updated?.threadId) setWorkflow(updated);
          message.success(
            updated?.status === 'cancelled' ? '工作流已取消' : '已发出取消请求',
          );
        } catch {
          message.error('取消失败，刷新后确认工作流状态');
        } finally {
          setSubmitting(false);
        }
      },
    });
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
    const result = await getProductionWorkflowHandoff(workflow.threadId);
    const handoff = unwrapData<Record<string, unknown>>(result);
    if (!handoff) throw new Error('交接包为空');
    return handoff;
  };

  const buildHandoffFiles = (handoff: Record<string, unknown>) => {
    const context =
      handoff.context &&
      typeof handoff.context === 'object' &&
      !Array.isArray(handoff.context)
        ? (handoff.context as Record<string, unknown>)
        : handoff;
    const stages = Array.isArray(context.stages)
      ? (context.stages as Array<Record<string, unknown>>)
      : [];
    const schemas = Array.isArray(handoff.schemas)
      ? (handoff.schemas as Array<Record<string, unknown>>)
      : stages.flatMap((stage) =>
          Array.isArray(stage.lowCodeSchemas) ? stage.lowCodeSchemas : [],
        );
    const evidence: Array<Record<string, unknown>> = Array.isArray(
      handoff.citations,
    )
      ? (handoff.citations as Array<Record<string, unknown>>)
      : stages.flatMap((stage) =>
          (Array.isArray(stage.evidence) ? stage.evidence : []).map((item) => ({
            role: stage.role,
            ...(item as Record<string, unknown>),
          })),
        );
    const files: Array<{ name: string; content: string }> = [
      {
        name: 'RAG_WORKFLOW_CONTEXT.json',
        content: `${JSON.stringify(context, null, 2)}\n`,
      },
      {
        name: 'HANDOFF_MANIFEST.json',
        content: `${JSON.stringify(handoff.manifest ?? handoff, null, 2)}\n`,
      },
      {
        name: 'LOW_CODE_SCHEMAS.json',
        content: `${JSON.stringify(schemas, null, 2)}\n`,
      },
      {
        name: 'RAG_EVIDENCE.json',
        content: `${JSON.stringify(evidence, null, 2)}\n`,
      },
      {
        name: 'README.md',
        content: `# ${workflow?.projectId ?? '产研运项目'} 产研运交接物\n\n本目录由已完成的产研运工作流导出，供 Codex、Claude、Cursor 等 AI Coding 工具使用。先阅读 \`HANDOFF.md\`，结构化 Schema 在 \`LOW_CODE_SCHEMAS.json\` 与 \`schemas/\`，RAG 引用证据在 \`RAG_EVIDENCE.md\`。\n`,
      },
      {
        name: 'RAG_EVIDENCE.md',
        content: [
          '# RAG 引用证据',
          evidence.length > 0
            ? evidence
                .map(
                  (item) =>
                    `- [${String(item.role ?? 'unknown')}] ${String(item.id ?? 'unknown')}：文档 ${String(item.docId ?? 'unknown')}／片段 ${String(item.chunkIndex ?? 'unknown')}／评分 ${String(item.totalScore ?? 'unknown')}\n  - ${String(item.excerpt ?? '')}`,
                )
                .join('\n')
            : '本次工作流未检索到可引用的 RAG 证据。',
        ].join('\n\n'),
      },
    ];
    const handoffSections: string[] = [];
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
        handoffSections.push(
          `## ${role}／${title}\n\n${String(deliverable.markdown ?? '')}`,
        );
      });
    });
    files.push({
      name: 'HANDOFF.md',
      content:
        typeof handoff.markdown === 'string'
          ? handoff.markdown
          : [
              `# ${workflow?.projectId ?? '产研运项目'} 产研运交接包`,
              '本文件供 AI Coding 工具阅读；结构化 Schema 见 `LOW_CODE_SCHEMAS.json`，RAG 引用证据见 `RAG_EVIDENCE.md`。',
              ...handoffSections,
            ].join('\n\n'),
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
      message.success('已导出 Markdown、Schema 与 RAG 引用证据到所选代码目录');
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

  const previewPlaywayPage = async () => {
    if (!workflow) return;
    try {
      const response = await getProductionPlaywayPreview(workflow.threadId);
      const preview = unwrapData<{
        title: string;
        html: string;
        componentTypes: string[];
      }>(response);
      if (!preview?.html) {
        throw new Error('预览接口未返回 HTML 内容');
      }
      const blob = new Blob([preview.html], {
        type: 'text/html;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : '活动预览生成失败',
      );
    }
  };

  const syncPlaywayGraph = async () => {
    if (!workflow) return;
    try {
      await importProductionPlaywayGraph(
        workflow.brief || workflow.projectId,
        `playway:workflow:${workflow.threadId}`,
      );
      message.success('Playway 活动关系已同步到 Neo4j');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Neo4j 同步失败');
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
            {['running', 'pending_approval', 'revision_required'].includes(
              workflow.status,
            ) && (
              <Button
                danger
                icon={<CloseOutlined />}
                loading={submitting}
                onClick={handleCancel}
                style={{ marginLeft: 8 }}
              >
                取消工作流
              </Button>
            )}
            {workflow.status === 'completed' && (
              <>
                <Button
                  icon={<ExportOutlined />}
                  loading={exporting}
                  onClick={() => void exportMarkdownDirectory()}
                  style={{ marginLeft: 8 }}
                >
                  导出交接包（Markdown＋Schema）
                </Button>
                <Button
                  onClick={() => void previewPlaywayPage()}
                  style={{ marginLeft: 8 }}
                >
                  预览 Playway 活动页
                </Button>
                <Button
                  onClick={() => void syncPlaywayGraph()}
                  style={{ marginLeft: 8 }}
                >
                  同步活动图谱
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
              ['failed', 'cancelled'].includes(workflow.status) &&
              index === workflow.stageIndex
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
                        : workflow.status === 'cancelled'
                          ? 'default'
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

      {(workflow.schemaIssues?.length ?? 0) > 0 && (
        <Card title="Schema 闭合校验" style={{ marginTop: 16 }}>
          {workflow.schemaIssues?.map((issue) => (
            <p key={issue} style={{ color: '#d4380d', marginBottom: 6 }}>
              {issue}
            </p>
          ))}
        </Card>
      )}

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

      <Card title="多形态产物工作台" style={{ marginTop: 16 }}>
        <p>
          从已审批工作流生成 Schema、Vue/React 页面或数字大屏。可多选；当前 Schema 是工作流内部结构，真实平台组件 ID 和导入契约待确认，代码 ZIP 由 Schema 生成。
        </p>
        <Checkbox.Group
          options={ARTIFACT_OPTIONS}
          value={artifactTargets}
          onChange={(values) => {
            setArtifactTargets(values as ProductionArtifactTarget[]);
            setEditDraft(null);
          }}
        />
        <div style={{ marginTop: 12 }}>
          <Button
            type="primary"
            icon={<CodeOutlined />}
            loading={artifactBusy}
            disabled={artifactTargets.length === 0}
            onClick={() => void generateSelectedArtifacts()}
          >
            生成所选产物
          </Button>
          <Button
            icon={<ReloadOutlined />}
            loading={artifactBusy}
            onClick={() => void refreshArtifactVersions()}
            style={{ marginLeft: 8 }}
          >
            刷新版本
          </Button>
          <Tag color="gold" style={{ marginLeft: 8 }}>
            低代码同步：模拟模式，不写入真实平台
          </Tag>
        </div>

        <section style={{ marginTop: 20, padding: 16, background: '#f8fafc', borderRadius: 8 }}>
          <strong>自然语言修改 Schema</strong>
          <p style={{ margin: '6px 0 12px', color: '#667085' }}>
            先生成 Schema。修改建议会先展示字段差异；点击“应用并生成新版本”后才会保存。代码版本可随新 Schema 一起重新生成。
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Select
              value={editTarget}
              style={{ width: 180 }}
              options={[
                { value: 'activity-schema', label: '活动页 Schema' },
                { value: 'dashboard-schema', label: '数字大屏 Schema' },
              ]}
              onChange={(value) => {
                setEditTarget(value);
                setEditBaseArtifactId('');
                setEditDraft(null);
              }}
            />
            <Select
              value={editBaseArtifactId || undefined}
              style={{ minWidth: 320, flex: '1 1 320px' }}
              placeholder="选择一个 Schema 版本"
              options={artifactVersions
                .filter(
                  (artifact) =>
                    artifact.kind === 'json' &&
                    artifact.metadata?.target === editTarget,
                )
                .map((artifact) => ({
                  value: artifact.id,
                  label: `${artifactLabel(artifact.metadata?.target)} v${String(artifact.metadata?.version ?? '?')} · ${new Date(artifact.createdAt).toLocaleString()}`,
                }))}
              onChange={(value) => {
                setEditBaseArtifactId(value);
                setEditDraft(null);
              }}
            />
          </div>
          <Input.TextArea
            rows={3}
            maxLength={4000}
            value={editInstruction}
            onChange={(event) => {
              setEditInstruction(event.target.value);
              setEditDraft(null);
            }}
            placeholder="例如：把页面标题改成春季预约活动，并增加一个规则说明区块"
            style={{ marginTop: 10 }}
          />
          <Button
            loading={editBusy}
            disabled={!editBaseArtifactId || !editInstruction.trim()}
            onClick={() => void proposeArtifactEdit()}
            style={{ marginTop: 8 }}
          >
            生成差异建议
          </Button>
          {editDraft && (
            <div style={{ marginTop: 14 }}>
              <strong>待确认差异（{editDraft.diff.length} 项）</strong>
              {editDraft.diff.length > 0 ? (
                <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 8 }}>
                  {editDraft.diff.map((change) => (
                    <div
                      key={change.path}
                      style={{ borderTop: '1px solid #e4e7ec', padding: '8px 0' }}
                    >
                      <strong>{change.path}</strong>
                      <pre style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>
                        {`原值：${change.before === undefined ? '（无）' : JSON.stringify(change.before, null, 2)}\n新值：${change.after === undefined ? '（无）' : JSON.stringify(change.after, null, 2)}`}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <p>没有字段变化。</p>
              )}
              <Button
                type="primary"
                loading={editBusy}
                disabled={editDraft.diff.length === 0}
                onClick={() => void applyArtifactEdit()}
              >
                应用并生成新版本
              </Button>
            </div>
          )}
        </section>

        <section style={{ marginTop: 20, padding: 16, background: '#fffaf0', borderRadius: 8 }}>
          <strong>自然语言修改生成代码</strong>
          <p style={{ margin: '6px 0 12px', color: '#667085' }}>
            选择已有 Vue、React 或大屏代码版本，描述修改要求。系统会先展示文件差异并编译预览；确认后保存为新 ZIP 版本。只修改页面组件和样式，不修改依赖、构建配置或关联 Schema。
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Select
              value={codeEditBaseArtifactId || undefined}
              style={{ minWidth: 360, flex: '1 1 360px' }}
              placeholder="选择一个 Vue / React / 大屏代码版本"
              options={artifactVersions
                .filter((artifact) => artifact.kind === 'code')
                .map((artifact) => ({
                  value: artifact.id,
                  label: `${artifactLabel(artifact.metadata?.target)} v${String(artifact.metadata?.version ?? '?')} · ${new Date(artifact.createdAt).toLocaleString()}`,
                }))}
              onChange={(value) => {
                setCodeEditBaseArtifactId(value);
                setCodeEditDraft(null);
              }}
            />
          </div>
          <Input.TextArea
            rows={3}
            maxLength={4000}
            value={codeEditInstruction}
            onChange={(event) => {
              setCodeEditInstruction(event.target.value);
              setCodeEditDraft(null);
            }}
            placeholder="例如：把主视觉标题改成春季预约活动，卡片改成两列布局，按钮使用深绿色"
            style={{ marginTop: 10 }}
          />
          <Button
            loading={codeEditBusy}
            disabled={!codeEditBaseArtifactId || !codeEditInstruction.trim()}
            onClick={() => void proposeCodeArtifactEdit()}
            style={{ marginTop: 8 }}
          >
            生成代码差异和预览
          </Button>
          {codeEditDraft && (
            <div style={{ marginTop: 14 }}>
              <strong>待确认代码修改（{codeEditDraft.diff.length} 个文件）</strong>
              {codeEditDraft.diff.map((change) => (
                <details key={change.path} style={{ marginTop: 8 }}>
                  <summary>{change.path}</summary>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    <div>
                      <strong>修改前</strong>
                      <pre style={{ maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {change.before}
                      </pre>
                    </div>
                    <div>
                      <strong>修改后</strong>
                      <pre style={{ maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {change.after}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
              <iframe
                title="代码修改候选预览"
                srcDoc={codeEditDraft.previewHtml}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                style={{ width: '100%', height: 360, marginTop: 12, border: '1px solid #eaecf0' }}
              />
              <Button
                type="primary"
                loading={codeEditBusy}
                disabled={!codeEditDraft.diff.length}
                onClick={() => void applyCodeArtifactEdit()}
                style={{ marginTop: 8 }}
              >
                应用代码并保存新 ZIP 版本
              </Button>
            </div>
          )}
        </section>

        <div style={{ marginTop: 20 }}>
          <strong>版本记录</strong>
          {artifactVersions.length === 0 ? (
            <p style={{ color: '#667085' }}>暂无版本，先选择产物并生成。</p>
          ) : (
            <div style={{ marginTop: 8 }}>
              {artifactVersions.map((artifact) => {
                const target = artifact.metadata?.target;
                const version = Number(artifact.metadata?.version ?? 0);
                const sameTarget = artifactVersions.filter(
                  (item) => item.metadata?.target === target,
                );
                const latest = Math.max(
                  0,
                  ...sameTarget.map((item) => Number(item.metadata?.version ?? 0)),
                );
                const isSchema =
                  target === 'activity-schema' || target === 'dashboard-schema';
                const lastSync = artifact.metadata?.lastSimulatedSync as
                  | { objectId?: string }
                  | undefined;
                return (
                  <div
                    key={artifact.id}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 8,
                      borderTop: '1px solid #eaecf0',
                      padding: '10px 0',
                    }}
                  >
                    <Tag color={isSchema ? 'blue' : 'purple'}>
                      {artifactLabel(target)}
                    </Tag>
                    <Tag>v{version || '?'}</Tag>
                    {artifact.metadata?.schemaOutOfSync === true && (
                      <Tag color="orange">源码已独立修改，Schema 未同步</Tag>
                    )}
                    <span style={{ color: '#667085', flex: '1 1 180px' }}>
                      {new Date(artifact.createdAt).toLocaleString()} · {artifact.filename}
                    </span>
                    {lastSync?.objectId && <Tag color="gold">模拟 ID：{lastSync.objectId}</Tag>}
                    <Button
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => void previewArtifact(artifact)}
                    >
                      预览
                    </Button>
                    <Button
                      size="small"
                      icon={<CodeOutlined />}
                      onClick={() => void viewArtifactSource(artifact)}
                    >
                      查看源文件
                    </Button>
                    <Button
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={() => void downloadArtifact(artifact)}
                    >
                      下载
                    </Button>
                    {target === 'activity-schema' && (
                      <Button
                        size="small"
                        icon={<CloudSyncOutlined />}
                        onClick={() => void simulateArtifactSync(artifact)}
                      >
                        模拟同步
                      </Button>
                    )}
                    {isSchema && version < latest && (
                      <Button
                        size="small"
                        icon={<HistoryOutlined />}
                        onClick={() => void restoreArtifactVersion(artifact)}
                      >
                        恢复为新版本
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card title="Agent 项目开发工作区" style={{ marginTop: 16 }}>
        <p>
          在 OpenSandbox 隔离工作区里让 Agent 修改项目、安装依赖和运行测试；可启动开发服务器预览，并把工作区导出为新的 ZIP 版本。工作区中的改动不会自动覆盖原始产物。
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Select
            value={workspaceArtifactId || undefined}
            style={{ minWidth: 360, flex: '1 1 360px' }}
            placeholder="选择用于开发的 Vue / React 项目 ZIP"
            options={artifactVersions
              .filter((artifact) => artifact.kind === 'code')
              .map((artifact) => ({
                value: artifact.id,
                label: `${artifactLabel(artifact.metadata?.target)} v${String(artifact.metadata?.version ?? '?')} · ${new Date(artifact.createdAt).toLocaleString()}`,
              }))}
            onChange={(value) => {
              setWorkspaceArtifactId(value);
              setWorkspaceAgentResult(null);
              setWorkspacePreviewUrl('');
            }}
          />
          <Button
            type="primary"
            loading={workspaceBusy}
            disabled={!workspaceArtifactId}
            onClick={() => void startWorkspace()}
          >
            启动 / 恢复工作区
          </Button>
          <Tag color={workspaceStatus?.ready ? 'green' : 'default'}>
            {workspaceStatus?.ready ? `工作区已就绪${workspaceStatus.projectRoot ? ` · ${workspaceStatus.projectRoot}` : ''}` : '工作区未启动'}
          </Tag>
          <Button
            danger
            loading={workspaceBusy}
            disabled={!workflow || workspaceBusy}
            onClick={destroyWorkspace}
          >
            销毁工作区
          </Button>
        </div>

        <section style={{ marginTop: 16, padding: 16, background: '#f8fafc', borderRadius: 8 }}>
          <strong>让 Agent 开发</strong>
          <Input.TextArea
            rows={3}
            maxLength={4000}
            value={workspaceInstruction}
            onChange={(event) => setWorkspaceInstruction(event.target.value)}
            placeholder="例如：安装项目依赖，修复构建报错，再运行测试并说明结果"
            style={{ marginTop: 10 }}
          />
          <Button
            type="primary"
            loading={workspaceBusy}
            disabled={!workspaceArtifactId || !workspaceInstruction.trim()}
            onClick={() => void runWorkspaceAgent()}
            style={{ marginTop: 8 }}
          >
            执行开发任务
          </Button>
          {workspaceAgentResult && (
            <div style={{ marginTop: 12 }}>
              <Tag color={workspaceAgentResult.status === 'completed' ? 'green' : 'orange'}>
                {workspaceAgentResult.status === 'completed' ? '任务完成' : '任务未完成'}
              </Tag>
              <p style={{ whiteSpace: 'pre-wrap' }}>{workspaceAgentResult.summary}</p>
              {workspaceAgentResult.steps?.map((step) => (
                <details key={`${step.command}-${step.exitCode}`} style={{ marginTop: 8 }}>
                  <summary>{step.command} · exit {step.exitCode}</summary>
                  <pre style={{ maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {step.output}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </section>

        <section style={{ marginTop: 16 }}>
          <strong>手动执行命令</strong>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Input
              value={workspaceCommand}
              onChange={(event) => setWorkspaceCommand(event.target.value)}
              onPressEnter={() => void runWorkspaceCommand()}
              placeholder="例如：npm test"
              disabled={!workspaceStatus?.ready || workspaceBusy}
            />
            <Button
              loading={workspaceBusy}
              disabled={!workspaceStatus?.ready || !workspaceCommand.trim()}
              onClick={() => void runWorkspaceCommand()}
            >
              执行
            </Button>
          </div>
          {workspaceCommandResult && (
            <pre style={{ maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {`exit ${workspaceCommandResult.exitCode}\n${workspaceCommandResult.output}`}
            </pre>
          )}
        </section>

        <section style={{ marginTop: 16 }}>
          <strong>开发服务器与预览</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <Input
              value={workspaceDevServerCommand}
              onChange={(event) => setWorkspaceDevServerCommand(event.target.value)}
              placeholder="npm run dev -- --host 0.0.0.0"
              style={{ flex: '1 1 360px' }}
              disabled={!workspaceStatus?.ready || workspaceBusy}
            />
            <Input
              value={workspacePort}
              onChange={(event) => setWorkspacePort(event.target.value)}
              placeholder="端口"
              style={{ width: 110 }}
              disabled={!workspaceStatus?.ready || workspaceBusy}
            />
            <Button
              loading={workspaceBusy}
              disabled={!workspaceStatus?.ready || !workspaceDevServerCommand.trim()}
              onClick={() => void startWorkspaceDevServer()}
            >
              启动服务器
            </Button>
            <Button
              loading={workspaceBusy}
              disabled={!workspaceStatus?.devServer || workspaceBusy}
              onClick={() => void stopWorkspaceDevServer()}
            >
              停止服务器
            </Button>
            <Button
              loading={workspaceBusy}
              disabled={!workspaceStatus?.ready}
              onClick={() => void openWorkspacePreview()}
            >
              打开预览
            </Button>
            <Button
              icon={<DownloadOutlined />}
              loading={workspaceBusy}
              disabled={!workspaceStatus?.ready}
              onClick={() => void exportWorkspace()}
            >
              导出新 ZIP
            </Button>
          </div>
          {workspacePreviewUrl && (
            <iframe
              title="Agent 开发工作区预览"
              src={workspacePreviewUrl}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              style={{ width: '100%', height: 560, marginTop: 12, border: '1px solid #eaecf0' }}
            />
          )}
        </section>
      </Card>

      <Modal
        title={previewTitle}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={null}
        width={1200}
        style={{ top: 24 }}
        destroyOnHidden
      >
        <iframe
          title={previewTitle}
          srcDoc={previewHtml}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={{ width: '100%', height: '72vh', border: '1px solid #eaecf0' }}
        />
      </Modal>

      <Modal
        title={sourceTitle}
        open={sourceOpen}
        onCancel={() => setSourceOpen(false)}
        footer={null}
        width={1000}
        destroyOnHidden
      >
        {Object.keys(sourceFiles).length > 1 && (
          <Select
            value={sourceFile}
            options={Object.keys(sourceFiles).map((path) => ({
              value: path,
              label: path,
            }))}
            onChange={setSourceFile}
            style={{ width: '100%', marginBottom: 12 }}
          />
        )}
        <pre
          style={{
            maxHeight: '70vh',
            overflow: 'auto',
            background: '#101828',
            color: '#e4e7ec',
            padding: 16,
            borderRadius: 8,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {sourceFiles[sourceFile] ?? ''}
        </pre>
      </Modal>

      <Card title="Playway 组件规则" style={{ marginTop: 16 }}>
        <Input.Search
          placeholder="搜索活动或玩法，例如：新服预约 抽卡"
          allowClear
          value={componentQuery}
          onChange={(event) => setComponentQuery(event.target.value)}
          onSearch={(value) => void searchComponentRules(value)}
          style={{ maxWidth: 520, marginBottom: 12 }}
        />
        <Collapse
          items={componentRules.map((rule) => ({
            key: rule.type,
            label: `${rule.displayName}（${rule.type}）`,
            children: (
              <div>
                <p>{rule.description}</p>
                <p>依赖：{rule.requires.join('、') || '无'}</p>
                <p>配置字段：{rule.configFields.join('、') || '无'}</p>
                <p>产出事件：{rule.emits.join('、') || '无'}</p>
                <Tag
                  color={
                    rule.risk === 'high'
                      ? 'red'
                      : rule.risk === 'medium'
                        ? 'orange'
                        : 'green'
                  }
                >
                  风险：{rule.risk}
                </Tag>
                {rule.compliance.map((item) => (
                  <Tag key={item}>{item}</Tag>
                ))}
              </div>
            ),
          }))}
        />
      </Card>

      <Card title="Playway 活动模板" style={{ marginTop: 16 }}>
        <Collapse
          items={activityTemplates.map((template) => ({
            key: template.id,
            label: template.name,
            children: (
              <div>
                <p>{template.goal}</p>
                <p>必选组件：{template.requiredComponents.join('、')}</p>
                <p>可选组件：{template.optionalComponents.join('、')}</p>
                <p>接口：{template.requiredApis.join('、')}</p>
                <p>埋点：{template.requiredEvents.join('、')}</p>
                <p>验收：</p>
                {template.acceptanceChecks.map((check) => (
                  <p key={check} style={{ marginBottom: 4 }}>
                    ・{check}
                  </p>
                ))}
                {template.riskNotes.map((risk) => (
                  <Tag key={risk} color="orange">
                    {risk}
                  </Tag>
                ))}
              </div>
            ),
          }))}
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
