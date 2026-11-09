import { authRequest } from '@/services/rag-admin/api';
import type { ProductionArtifactTarget } from './service';

const productionWorkspacePath = (threadId: string) =>
  `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/workspace`;

export const getProductionWorkspaceStatus = (threadId: string) =>
  authRequest<unknown>(productionWorkspacePath(threadId));

export const startProductionWorkspace = (
  threadId: string,
  body: { artifactId: string; role?: 'frontend' | 'backend' | 'qa' },
) =>
  authRequest<unknown>(`${productionWorkspacePath(threadId)}/start`, {
    method: 'POST',
    data: body,
  });

export const runProductionWorkspaceAgent = (
  threadId: string,
  body: { artifactId: string; instruction: string },
) =>
  authRequest<unknown>(`${productionWorkspacePath(threadId)}/agent`, {
    method: 'POST',
    data: body,
  });

export const submitProductionWorkspaceCodingTask = (
  threadId: string,
  body: {
    artifactId: string;
    instruction: string;
    requestId: string;
    role?: 'frontend' | 'backend' | 'qa';
    task?: 'code' | 'verify';
  },
) =>
  authRequest<unknown>(`${productionWorkspacePath(threadId)}/coding-tasks`, {
    method: 'POST',
    data: body,
  });

export const getProductionWorkspaceCodingTask = (
  threadId: string,
  taskId: string,
) =>
  authRequest<unknown>(
    `${productionWorkspacePath(threadId)}/coding-tasks/${encodeURIComponent(taskId)}`,
  );

export const cancelProductionWorkspaceCodingTask = (
  threadId: string,
  taskId: string,
  body: { reason?: string } = {},
) =>
  authRequest<unknown>(
    `${productionWorkspacePath(threadId)}/coding-tasks/${encodeURIComponent(taskId)}/cancel`,
    { method: 'POST', data: body },
  );

export const resumeProductionWorkspaceCodingTask = (
  threadId: string,
  taskId: string,
) =>
  authRequest<unknown>(
    `${productionWorkspacePath(threadId)}/coding-tasks/${encodeURIComponent(taskId)}/resume`,
    { method: 'POST', data: {} },
  );

export const runProductionWorkspaceCommand = (
  threadId: string,
  body: { command: string },
) =>
  authRequest<unknown>(`${productionWorkspacePath(threadId)}/command`, {
    method: 'POST',
    data: body,
  });

export const startProductionWorkspaceDevServer = (
  threadId: string,
  body: { port: number; command?: string },
) =>
  authRequest<unknown>(
    `${productionWorkspacePath(threadId)}/dev-server/start`,
    {
      method: 'POST',
      data: body,
    },
  );

export const stopProductionWorkspaceDevServer = (threadId: string) =>
  authRequest<unknown>(`${productionWorkspacePath(threadId)}/dev-server/stop`, {
    method: 'POST',
    data: {},
  });

export const createProductionWorkspacePreviewTicket = (
  threadId: string,
  body: { port: number },
) =>
  authRequest<unknown>(`${productionWorkspacePath(threadId)}/preview-ticket`, {
    method: 'POST',
    data: body,
  });

export const exportProductionWorkspace = (threadId: string) =>
  authRequest<unknown>(`${productionWorkspacePath(threadId)}/export`, {
    method: 'POST',
    data: {},
  });

export const deleteProductionWorkspace = (
  threadId: string,
  body: { confirmDiscard: true },
) =>
  authRequest<unknown>(productionWorkspacePath(threadId), {
    method: 'DELETE',
    data: body,
  });

export const getProductionWorkflowArtifacts = (threadId: string) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts`,
  );

export const generateProductionWorkflowArtifacts = (
  threadId: string,
  targets: ProductionArtifactTarget[],
) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/generate`,
    { method: 'POST', data: { targets } },
  );

export const proposeProductionArtifactEdit = (
  threadId: string,
  body: {
    target: 'activity-schema' | 'dashboard-schema';
    baseArtifactId: string;
    instruction: string;
  },
) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/edit`,
    { method: 'POST', data: body },
  );

export const proposeProductionCodeEdit = (
  threadId: string,
  body: { baseArtifactId: string; instruction: string },
) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/code-edit`,
    { method: 'POST', data: body },
  );

export const applyProductionCodeEdit = (
  threadId: string,
  body: {
    baseArtifactId: string;
    instruction: string;
    files: Record<string, string>;
  },
) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/code-edit/apply`,
    { method: 'POST', data: body },
  );

export const applyProductionArtifactEdit = (
  threadId: string,
  body: {
    target: 'activity-schema' | 'dashboard-schema';
    baseArtifactId: string;
    schema: Record<string, unknown>;
    regenerateTargets: ProductionArtifactTarget[];
  },
) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/apply`,
    { method: 'POST', data: body },
  );

export const restoreProductionArtifactVersion = (
  threadId: string,
  artifactId: string,
) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/restore`,
    { method: 'POST', data: { artifactId } },
  );

export const simulateProductionArtifactSync = (
  threadId: string,
  artifactId: string,
) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/${encodeURIComponent(artifactId)}/simulated-sync`,
    { method: 'POST', data: {} },
  );

export const getProductionArtifactPreview = (
  threadId: string,
  artifactId: string,
) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/${encodeURIComponent(artifactId)}/preview`,
  );

export const getProductionArtifactSource = (
  threadId: string,
  artifactId: string,
) =>
  authRequest<unknown>(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/${encodeURIComponent(artifactId)}/source`,
  );

export const downloadProductionArtifact = (
  threadId: string,
  artifactId: string,
) =>
  fetch(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/artifacts/${encodeURIComponent(artifactId)}/download`,
    {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}`,
      },
    },
  );

export const downloadProductionWorkspaceCodingTaskReport = (
  threadId: string,
  taskId: string,
) =>
  fetch(
    `/api/admin/agent-ops/workflows/${encodeURIComponent(threadId)}/workspace/coding-tasks/${encodeURIComponent(taskId)}/report/download`,
    {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}`,
      },
    },
  );
