import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProductionWorkspaceStatus: vi.fn(),
  startProductionWorkspace: vi.fn(),
  runProductionWorkspaceCommand: vi.fn(),
  startProductionWorkspaceDevServer: vi.fn(),
  stopProductionWorkspaceDevServer: vi.fn(),
  createProductionWorkspacePreviewTicket: vi.fn(),
  deleteProductionWorkspace: vi.fn(),
  exportProductionWorkspace: vi.fn(),
  submitProductionWorkspaceCodingTask: vi.fn(),
  getProductionWorkspaceCodingTask: vi.fn(),
  cancelProductionWorkspaceCodingTask: vi.fn(),
  resumeProductionWorkspaceCodingTask: vi.fn(),
  reviewProductionWorkspaceCodingTask: vi.fn(),
}));

vi.mock('antd', () => ({
  Modal: { confirm: vi.fn() },
  message: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('../service', () => ({
  createProductionWorkspacePreviewTicket:
    mocks.createProductionWorkspacePreviewTicket,
  deleteProductionWorkspace: mocks.deleteProductionWorkspace,
  exportProductionWorkspace: mocks.exportProductionWorkspace,
  getProductionWorkspaceStatus: mocks.getProductionWorkspaceStatus,
  runProductionWorkspaceCommand: mocks.runProductionWorkspaceCommand,
  startProductionWorkspace: mocks.startProductionWorkspace,
  startProductionWorkspaceDevServer: mocks.startProductionWorkspaceDevServer,
  stopProductionWorkspaceDevServer: mocks.stopProductionWorkspaceDevServer,
  unwrapData: (value: unknown) => value,
}));

vi.mock('../workspace-service', () => ({
  cancelProductionWorkspaceCodingTask:
    mocks.cancelProductionWorkspaceCodingTask,
  getProductionWorkspaceCodingTask: mocks.getProductionWorkspaceCodingTask,
  resumeProductionWorkspaceCodingTask:
    mocks.resumeProductionWorkspaceCodingTask,
  reviewProductionWorkspaceCodingTask:
    mocks.reviewProductionWorkspaceCodingTask,
  submitProductionWorkspaceCodingTask:
    mocks.submitProductionWorkspaceCodingTask,
}));

import { useWorkflowWorkspaceController } from './workflow-detail-workspace-controller';

describe('workflow workspace coding task controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.getProductionWorkspaceStatus.mockResolvedValue({
      ready: false,
      projectRoot: null,
      artifactId: 'artifact-1',
    });
    mocks.submitProductionWorkspaceCodingTask.mockResolvedValue({
      taskId: 'task-1',
      runId: 'run-1',
      status: 'queued',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('submits without starting or awaiting the workspace agent and polls the task', async () => {
    const { result, unmount } = renderHook(() =>
      useWorkflowWorkspaceController({
        workflow: { threadId: 'thread-1' } as never,
        artifactVersions: [],
        refreshArtifactVersions: vi.fn(),
        downloadArtifact: vi.fn(),
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      result.current.setWorkspaceInstruction('修复构建问题');
    });
    await act(async () => {
      await result.current.runWorkspaceAgent();
    });

    expect(mocks.submitProductionWorkspaceCodingTask).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({
        artifactId: 'artifact-1',
        instruction: '修复构建问题',
        requestId: expect.any(String),
      }),
    );
    expect(mocks.startProductionWorkspace).not.toHaveBeenCalled();
    expect(mocks.getProductionWorkspaceCodingTask).not.toHaveBeenCalled();
    expect(result.current.workspaceCodingTask?.status).toBe('queued');

    mocks.getProductionWorkspaceCodingTask.mockResolvedValue({
      taskId: 'task-1',
      runId: 'run-1',
      threadId: 'thread-1',
      status: 'running',
      attempt: 1,
      lastCompletedStep: 1,
      summary: null,
      error: null,
      verification: null,
      events: [],
      updatedAt: '2026-11-07T00:00:00.000Z',
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mocks.getProductionWorkspaceCodingTask).toHaveBeenCalledWith(
      'thread-1',
      'task-1',
    );
    expect(result.current.workspaceCodingTask?.status).toBe('running');
    unmount();
  });

  it('submits QA as a verify task against the bound backend artifact', async () => {
    const { result, unmount } = renderHook(() =>
      useWorkflowWorkspaceController({
        workflow: { threadId: 'thread-1' } as never,
        artifactVersions: [
          {
            id: 'artifact-1',
            kind: 'code',
            metadata: { target: 'nestjs-api', version: 1 },
          } as never,
        ],
        refreshArtifactVersions: vi.fn(),
        downloadArtifact: vi.fn(),
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      result.current.setWorkspaceRole('qa');
      result.current.setWorkspaceInstruction('检查后端项目');
    });
    await act(async () => {
      await result.current.runWorkspaceAgent();
    });

    expect(mocks.submitProductionWorkspaceCodingTask).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({
        artifactId: 'artifact-1',
        role: 'qa',
        task: 'verify',
      }),
    );
    expect(result.current.workspaceTask).toBe('verify');
    unmount();
  });

  it('cancels the active task and reloads its persisted status', async () => {
    const { result, unmount } = renderHook(() =>
      useWorkflowWorkspaceController({
        workflow: { threadId: 'thread-1' } as never,
        artifactVersions: [],
        refreshArtifactVersions: vi.fn(),
        downloadArtifact: vi.fn(),
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      result.current.setWorkspaceInstruction('修复构建问题');
    });
    await act(async () => {
      await result.current.runWorkspaceAgent();
    });
    mocks.cancelProductionWorkspaceCodingTask.mockResolvedValue({
      taskId: 'task-1',
      runId: 'run-1',
      status: 'cancelled',
    });
    mocks.getProductionWorkspaceCodingTask.mockResolvedValue({
      taskId: 'task-1',
      runId: 'run-1',
      threadId: 'thread-1',
      status: 'cancelled',
      attempt: 1,
      lastCompletedStep: 0,
      summary: null,
      error: '用户取消运行',
      verification: null,
      events: [],
      updatedAt: '2026-11-07T00:00:00.000Z',
    });

    await act(async () => {
      await result.current.cancelWorkspaceCodingTask();
    });

    expect(mocks.cancelProductionWorkspaceCodingTask).toHaveBeenCalledWith(
      'thread-1',
      'task-1',
    );
    expect(result.current.workspaceCodingTask?.status).toBe('cancelled');
    unmount();
  });

  it('submits an idempotent QA review and reloads the reviewed task', async () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'review-request-id') });
    const { result, unmount } = renderHook(() =>
      useWorkflowWorkspaceController({
        workflow: { threadId: 'thread-1' } as never,
        artifactVersions: [],
        refreshArtifactVersions: vi.fn(),
        downloadArtifact: vi.fn(),
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      result.current.setWorkspaceRole('qa');
      result.current.setWorkspaceInstruction('检查项目');
    });
    await act(async () => {
      await result.current.runWorkspaceAgent();
    });

    const waitingReview = {
      taskId: 'task-1',
      runId: 'run-1',
      threadId: 'thread-1',
      role: 'qa' as const,
      taskType: 'verify' as const,
      status: 'waiting_review' as const,
      attempt: 1,
      lastCompletedStep: 1,
      summary: '待审阅',
      error: null,
      verification: null,
      events: [],
      updatedAt: '2026-11-09T00:00:00.000Z',
    };
    mocks.getProductionWorkspaceCodingTask.mockResolvedValue(waitingReview);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.workspaceCodingTask?.status).toBe('waiting_review');

    const approved = { ...waitingReview, status: 'approved' as const };
    mocks.reviewProductionWorkspaceCodingTask.mockResolvedValue({
      taskId: 'task-1', status: 'approved',
    });
    mocks.getProductionWorkspaceCodingTask.mockResolvedValueOnce(approved);
    await act(async () => {
      await result.current.reviewWorkspaceCodingTask('approved');
    });

    expect(mocks.reviewProductionWorkspaceCodingTask).toHaveBeenCalledWith(
      'thread-1',
      'task-1',
      { reviewId: 'review-request-id', decision: 'approved' },
    );
    expect(result.current.workspaceCodingTask?.status).toBe('approved');
    unmount();
  });
});
