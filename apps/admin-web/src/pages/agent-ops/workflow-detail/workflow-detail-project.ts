import { message } from 'antd';
import type React from 'react';
import type { ProductionWorkflow } from '../service';
import { downloadProductionWorkflowProjectZip } from '../service';

export async function generateRunnableProjectFile(
  workflow: ProductionWorkflow | null,
  setGeneratingProject: React.Dispatch<React.SetStateAction<boolean>>,
) {
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
}
