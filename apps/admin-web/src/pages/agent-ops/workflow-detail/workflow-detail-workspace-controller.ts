import { Modal, message } from 'antd';
import React from 'react';
import {
  createProductionWorkspacePreviewTicket,
  deleteProductionWorkspace,
  exportProductionWorkspace,
  getProductionWorkspaceStatus,
  type ProductionArtifactVersion,
  type ProductionWorkflow,
  type ProductionWorkspaceStatus,
  runProductionWorkspaceAgent,
  runProductionWorkspaceCommand,
  startProductionWorkspace,
  startProductionWorkspaceDevServer,
  stopProductionWorkspaceDevServer,
  unwrapData,
} from '../service';
import type {
  ProductionWorkspaceAgentResult,
  ProductionWorkspaceCommandResult,
} from './workflow-detail-shared';

type WorkspaceStatusWithArtifact = ProductionWorkspaceStatus & {
  artifactId?: string;
};

interface WorkflowWorkspaceControllerOptions {
  workflow: ProductionWorkflow | null;
  refreshArtifactVersions: () => Promise<void>;
  downloadArtifact: (artifact: ProductionArtifactVersion) => Promise<void>;
}

export function useWorkflowWorkspaceController({
  workflow,
  refreshArtifactVersions,
  downloadArtifact,
}: WorkflowWorkspaceControllerOptions) {
  const [workspaceStatus, setWorkspaceStatus] =
    React.useState<WorkspaceStatusWithArtifact | null>(null);
  const [workspaceStatusLoading, setWorkspaceStatusLoading] =
    React.useState(false);
  const [workspaceStatusLoadFailed, setWorkspaceStatusLoadFailed] =
    React.useState(false);
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

  React.useEffect(() => {
    if (!workflow?.threadId) {
      setWorkspaceStatus(null);
      setWorkspaceArtifactId('');
      setWorkspaceStatusLoading(false);
      setWorkspaceStatusLoadFailed(false);
      return;
    }
    let active = true;
    setWorkspaceStatusLoading(true);
    setWorkspaceStatusLoadFailed(false);
    setWorkspaceArtifactId('');
    getProductionWorkspaceStatus(workflow.threadId)
      .then((response) => {
        if (active) {
          const status =
            unwrapData<WorkspaceStatusWithArtifact>(response) ?? null;
          if (!status) {
            setWorkspaceStatus(null);
            setWorkspaceStatusLoadFailed(true);
            return;
          }
          setWorkspaceStatus(status);
          setWorkspaceArtifactId(status.artifactId ?? '');
          setWorkspaceStatusLoadFailed(false);
        }
      })
      .catch(() => {
        if (active) {
          setWorkspaceStatus(null);
          setWorkspaceStatusLoadFailed(true);
        }
      })
      .finally(() => {
        if (active) setWorkspaceStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workflow?.threadId]);

  const startWorkspace = async () => {
    if (
      workspaceStatusLoading ||
      workspaceStatusLoadFailed ||
      !workspaceStatus
    ) {
      message.warning('当前工作区状态未确认，请刷新页面后重试');
      return false;
    }
    if (!workflow || !workspaceArtifactId) {
      message.error('请选择要放入开发工作区的代码版本');
      return false;
    }
    setWorkspaceBusy(true);
    try {
      const response = await startProductionWorkspace(workflow.threadId, {
        artifactId: workspaceArtifactId,
      });
      const status = unwrapData<WorkspaceStatusWithArtifact>(response);
      if (!status) {
        setWorkspaceStatus(null);
        setWorkspaceStatusLoadFailed(true);
        throw new Error('工作区状态响应为空，无法确认启动结果');
      }
      setWorkspaceStatus(status);
      setWorkspaceArtifactId(status.artifactId ?? workspaceArtifactId);
      setWorkspaceStatusLoadFailed(false);
      if (!status.ready) throw new Error('开发工作区尚未就绪');
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
    if (
      workspaceStatusLoading ||
      workspaceStatusLoadFailed ||
      !workspaceStatus
    ) {
      message.warning('当前工作区状态未确认，请刷新页面后重试');
      return;
    }
    if (!workflow || !workspaceArtifactId || !workspaceInstruction.trim()) {
      message.error('请选择代码版本并填写开发要求');
      return;
    }
    setWorkspaceBusy(true);
    setWorkspaceAgentResult(null);
    setWorkspaceCommandResult(null);
    try {
      if (!workspaceStatus.ready) {
        const started = await startProductionWorkspace(workflow.threadId, {
          artifactId: workspaceArtifactId,
        });
        const status = unwrapData<WorkspaceStatusWithArtifact>(started);
        if (!status) {
          setWorkspaceStatus(null);
          setWorkspaceStatusLoadFailed(true);
          throw new Error('工作区状态响应为空，无法确认启动结果');
        }
        setWorkspaceStatus(status);
        setWorkspaceArtifactId(status.artifactId ?? workspaceArtifactId);
        setWorkspaceStatusLoadFailed(false);
        if (!status.ready) throw new Error('开发工作区尚未就绪');
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
        const status = unwrapData<WorkspaceStatusWithArtifact>(statusResponse);
        if (!status) {
          setWorkspaceStatus(null);
          setWorkspaceStatusLoadFailed(true);
        } else {
          setWorkspaceStatus(status);
          setWorkspaceArtifactId(status.artifactId ?? workspaceArtifactId);
          setWorkspaceStatusLoadFailed(false);
        }
      } catch {
        setWorkspaceStatusLoadFailed(true);
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
        artifactId: current?.artifactId,
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
          setWorkspaceArtifactId('');
          try {
            const response = await getProductionWorkspaceStatus(
              workflow.threadId,
            );
            const status =
              unwrapData<WorkspaceStatusWithArtifact>(response) ?? null;
            if (!status) throw new Error('工作区状态响应为空');
            setWorkspaceStatus(status);
            setWorkspaceArtifactId(status.artifactId ?? '');
            setWorkspaceStatusLoadFailed(false);
          } catch {
            setWorkspaceStatus(null);
            setWorkspaceStatusLoadFailed(true);
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

  return {
    workspaceStatus,
    workspaceStatusLoading,
    workspaceStatusLoadFailed,
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
    startWorkspace,
    runWorkspaceAgent,
    runWorkspaceCommand,
    startWorkspaceDevServer,
    stopWorkspaceDevServer,
    destroyWorkspace,
    openWorkspacePreview,
    exportWorkspace,
  };
}
