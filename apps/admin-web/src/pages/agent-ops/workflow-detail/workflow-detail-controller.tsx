import { useParams } from '@umijs/max';
import { Form, Modal, message } from 'antd';
import React from 'react';
import {
  applyProductionArtifactEdit,
  applyProductionCodeEdit,
  cancelProductionWorkflow,
  createProductionWorkspacePreviewTicket,
  deleteProductionWorkspace,
  downloadProductionArtifact,
  exportProductionWorkspace,
  generateProductionWorkflowArtifacts,
  getProductionActivityTemplates,
  getProductionArtifactPreview,
  getProductionArtifactSource,
  getProductionComponentRules,
  getProductionPlaywayPreview,
  getProductionWorkflow,
  getProductionWorkflowArtifacts,
  getProductionWorkflowHandoff,
  getProductionWorkspaceStatus,
  importProductionPlaywayGraph,
  type PlaywayActivityTemplate,
  type PlaywayComponentRule,
  type ProductionArtifactTarget,
  type ProductionArtifactVersion,
  type ProductionWorkflow,
  type ProductionWorkspaceStatus,
  proposeProductionArtifactEdit,
  proposeProductionCodeEdit,
  restoreProductionArtifactVersion,
  resumeProductionWorkflow,
  reviseProductionWorkflow,
  runProductionWorkspaceAgent,
  runProductionWorkspaceCommand,
  simulateProductionArtifactSync,
  startProductionWorkspace,
  startProductionWorkspaceDevServer,
  stopProductionWorkspaceDevServer,
  unwrapData,
} from '../service';
import { buildHandoffFiles } from './workflow-detail-export';
import { generateRunnableProjectFile } from './workflow-detail-project';
import type {
  ProductionArtifactEditDraft,
  ProductionCodeEditDraft,
  ProductionWorkspaceAgentResult,
  ProductionWorkspaceCommandResult,
} from './workflow-detail-shared';

export function useWorkflowDetailController() {
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

  const [editDraft, setEditDraft] =
    React.useState<ProductionArtifactEditDraft | null>(null);

  const [editBusy, setEditBusy] = React.useState(false);

  const [codeEditBaseArtifactId, setCodeEditBaseArtifactId] =
    React.useState('');

  const [codeEditInstruction, setCodeEditInstruction] = React.useState('');

  const [codeEditDraft, setCodeEditDraft] =
    React.useState<ProductionCodeEditDraft | null>(null);

  const [codeEditBusy, setCodeEditBusy] = React.useState(false);

  const [workspaceStatus, setWorkspaceStatus] =
    React.useState<ProductionWorkspaceStatus | null>(null);

  const [workspaceArtifactId, setWorkspaceArtifactId] = React.useState('');

  const [workspaceBusy, setWorkspaceBusy] = React.useState(false);

  const [workspaceInstruction, setWorkspaceInstruction] = React.useState('');

  const [workspaceAgentResult, setWorkspaceAgentResult] =
    React.useState<ProductionWorkspaceAgentResult | null>(null);

  const [workspaceCommand, setWorkspaceCommand] = React.useState('');

  const [workspaceCommandResult, setWorkspaceCommandResult] =
    React.useState<ProductionWorkspaceCommandResult | null>(null);

  const [workspaceDevServerCommand, setWorkspaceDevServerCommand] =
    React.useState('npm run dev -- --host 0.0.0.0');

  const [workspacePort, setWorkspacePort] = React.useState('5173');

  const [workspacePreviewUrl, setWorkspacePreviewUrl] = React.useState('');

  const [previewOpen, setPreviewOpen] = React.useState(false);

  const [previewTitle, setPreviewTitle] = React.useState('产物预览');

  const [previewHtml, setPreviewHtml] = React.useState('');

  const [sourceOpen, setSourceOpen] = React.useState(false);

  const [sourceTitle, setSourceTitle] = React.useState('产物源文件');

  const [sourceFiles, setSourceFiles] = React.useState<Record<string, string>>(
    {},
  );

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
      const result = unwrapData<{ items?: ProductionArtifactVersion[] }>(
        response,
      );
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
      message.error(
        error instanceof Error ? error.message : 'Schema 修改建议生成失败',
      );
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
      message.error(
        error instanceof Error ? error.message : '应用 Schema 修改失败',
      );
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
      message.error(
        error instanceof Error ? error.message : '代码修改建议生成失败',
      );
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
      message.error(
        error instanceof Error ? error.message : '应用代码修改失败',
      );
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
      message.error(
        error instanceof Error ? error.message : '启动开发工作区失败',
      );
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
        const statusResponse = await getProductionWorkspaceStatus(
          workflow.threadId,
        );
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
      message.error(
        error instanceof Error ? error.message : 'Agent 开发任务失败',
      );
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
      const response = await startProductionWorkspaceDevServer(
        workflow.threadId,
        {
          port,
          command: workspaceDevServerCommand.trim() || undefined,
        },
      );
      const result = unwrapData<{
        port: number;
        commandId: string;
        status: string;
      }>(response);
      if (!result) throw new Error('开发服务器没有返回状态');
      setWorkspaceStatus((current) => ({
        ready: true,
        projectRoot: current?.projectRoot ?? null,
        devServer: { port: result.port, commandId: result.commandId },
      }));
      setWorkspacePort(String(result.port));
      message.success(`开发服务器已启动（端口 ${result.port}）`);
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : '启动开发服务器失败',
      );
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
      message.error(
        error instanceof Error ? error.message : '停止开发服务器失败',
      );
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const destroyWorkspace = () => {
    if (!workflow) return;
    Modal.confirm({
      title: '销毁开发工作区？',
      content:
        '未导出的修改会丢失。销毁后，若要继续开发，需要重新选择代码产物并启动工作区。',
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
            const response = await getProductionWorkspaceStatus(
              workflow.threadId,
            );
            setWorkspaceStatus(
              unwrapData<ProductionWorkspaceStatus>(response) ?? null,
            );
          } catch {
            setWorkspaceStatus(null);
          }
          message.success('工作区已销毁');
        } catch (error) {
          message.error(
            error instanceof Error ? error.message : '销毁工作区失败',
          );
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
      message.error(
        error instanceof Error ? error.message : '创建开发预览失败',
      );
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
      const result = unwrapData<{ artifact?: ProductionArtifactVersion }>(
        response,
      );
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
      const result = unwrapData<{ objectId?: string; simulated?: boolean }>(
        response,
      );
      await refreshArtifactVersions();
      message.success(
        `模拟同步完成：${result.objectId ?? '已生成模拟记录'}（未调用真实平台）`,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模拟同步失败');
    }
  };

  const restoreArtifactVersion = async (
    artifact: ProductionArtifactVersion,
  ) => {
    if (!workflow) return;
    try {
      await restoreProductionArtifactVersion(workflow.threadId, artifact.id);
      await refreshArtifactVersions();
      message.success('已按该历史 Schema 创建新的当前版本');
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : '恢复 Schema 版本失败',
      );
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

  const generateRunnableProject = () =>
    generateRunnableProjectFile(workflow, setGeneratingProject);

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

  return {
    form,
    workflow,
    loading,
    submitting,
    exporting,
    generatingProject,
    componentRules,
    componentQuery,
    setComponentQuery,
    activityTemplates,
    artifactTargets,
    setArtifactTargets,
    artifactVersions,
    artifactBusy,
    editTarget,
    setEditTarget,
    editBaseArtifactId,
    setEditBaseArtifactId,
    editInstruction,
    setEditInstruction,
    editDraft,
    setEditDraft,
    editBusy,
    codeEditBaseArtifactId,
    setCodeEditBaseArtifactId,
    codeEditInstruction,
    setCodeEditInstruction,
    codeEditDraft,
    setCodeEditDraft,
    codeEditBusy,
    workspaceStatus,
    workspaceArtifactId,
    setWorkspaceArtifactId,
    workspaceBusy,
    workspaceInstruction,
    setWorkspaceInstruction,
    workspaceAgentResult,
    setWorkspaceAgentResult,
    workspaceCommand,
    setWorkspaceCommand,
    workspaceCommandResult,
    workspaceDevServerCommand,
    setWorkspaceDevServerCommand,
    workspacePort,
    setWorkspacePort,
    workspacePreviewUrl,
    setWorkspacePreviewUrl,
    previewOpen,
    setPreviewOpen,
    previewTitle,
    previewHtml,
    sourceOpen,
    setSourceOpen,
    sourceTitle,
    sourceFiles,
    sourceFile,
    setSourceFile,
    loadDetail,
    searchComponentRules,
    refreshArtifactVersions,
    generateSelectedArtifacts,
    proposeArtifactEdit,
    applyArtifactEdit,
    proposeCodeArtifactEdit,
    applyCodeArtifactEdit,
    startWorkspace,
    runWorkspaceAgent,
    runWorkspaceCommand,
    startWorkspaceDevServer,
    stopWorkspaceDevServer,
    destroyWorkspace,
    openWorkspacePreview,
    exportWorkspace,
    previewArtifact,
    viewArtifactSource,
    downloadArtifact,
    simulateArtifactSync,
    restoreArtifactVersion,
    handleResume,
    handleRevise,
    handleCancel,
    exportMarkdownDirectory,
    generateRunnableProject,
    previewPlaywayPage,
    syncPlaywayGraph,
  };
}

export type WorkflowDetailController = ReturnType<
  typeof useWorkflowDetailController
>;
export type WorkflowDetailLoadedController = Omit<
  WorkflowDetailController,
  'workflow'
> & {
  workflow: NonNullable<WorkflowDetailController['workflow']>;
};
