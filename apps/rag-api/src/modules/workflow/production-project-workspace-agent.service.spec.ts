import { ProductionProjectWorkspaceAgentService } from './production-project-workspace-agent.service';
import type { AgentLoopInput } from '../agent-loop/agent-loop.types';

type WorkspaceAgentTestState = {
  role: 'frontend' | 'backend';
  instruction: string;
  events: Array<{
    action: 'command' | 'start_dev_server' | 'stop_dev_server' | 'complete';
    command: string;
    exitCode: number;
    detail: string;
    output: string;
  }>;
};

type WorkspaceAgentTestOutput = {
  summary: string;
  status: 'completed' | 'failed';
  steps: Array<{ command: string; exitCode: number; output: string }>;
  toolCalls: number;
};

describe('ProductionProjectWorkspaceAgentService', () => {
  it('runs arbitrary project commands only through the registered workspace tool', async () => {
    let leaseActive = false;
    const instructionModel = {
      invoke: jest
        .fn()
        .mockResolvedValueOnce({
          action: 'command',
          command: 'npm test',
          timeoutSeconds: 30,
          summary: 'Run the project tests.',
        })
        .mockResolvedValueOnce({
          action: 'complete',
          summary: 'Tests passed.',
        }),
    };
    const llm = {
      getAgenticModel: jest.fn(() => ({
        withStructuredOutput: jest.fn(() => instructionModel),
      })),
    };
    const workspace = {
      isWorkspaceTaskLeaseActive: jest.fn(() => leaseActive),
      withWorkspaceTaskLease: jest.fn(
        async (
          _threadId: string,
          _userId: string,
          _tenantId: string | undefined,
          callback: () => Promise<unknown>,
        ) => {
          leaseActive = true;
          try {
            return await callback();
          } finally {
            leaseActive = false;
          }
        },
      ),
      startWorkspace: jest.fn().mockResolvedValue({ ready: true }),
      runCommand: jest.fn().mockResolvedValue({
        command: 'npm test',
        output: 'All tests passed.',
        exitCode: 0,
        durationMs: 12,
        timedOut: false,
      }),
      startDevServer: jest.fn(),
      stopDevServer: jest.fn(),
    };
    const agentLoop = {
      run: jest.fn(
        async (
          input: AgentLoopInput<
            WorkspaceAgentTestState,
            WorkspaceAgentTestOutput
          >,
        ) => {
          const signal = new AbortController().signal;
          let state = input.initialState;
          const toolDecision = await input.decide(state, {
            step: 0,
            toolCalls: 0,
            remainingMs: 480_000,
            signal,
          });
          if (toolDecision.type !== 'tool') {
            throw new Error('Expected a workspace command tool decision.');
          }
          expect(toolDecision.name).toBe('workspace_agent_command');
          expect(toolDecision.role).toBe('backend');
          expect(toolDecision.allowedToolNames).toEqual([
            'workspace_agent_command',
          ]);
          const toolResult = await toolDecision.execute(signal);
          state = toolDecision.reduce(state, toolResult);
          const completion = await input.decide(state, {
            step: 1,
            toolCalls: 1,
            remainingMs: 479_000,
            signal,
          });
          if (completion.type !== 'complete') {
            throw new Error('Expected the workspace agent to complete.');
          }
          return {
            status: 'completed',
            state,
            output: completion.output,
            steps: 2,
            toolCalls: 1,
            terminationReason: completion.reason,
          };
        },
      ),
    };
    const service = new ProductionProjectWorkspaceAgentService(
      llm as never,
      agentLoop as never,
      workspace as never,
    );

    const result = await service.run(
      'thread-1',
      'owner-1',
      'tenant-1',
      'artifact-1',
      'Install and run tests.',
      { role: 'backend', strictRole: true },
    );

    expect(workspace.startWorkspace).toHaveBeenCalledWith(
      'thread-1',
      'owner-1',
      'tenant-1',
      'artifact-1',
      'backend',
      'code',
      true,
    );
    expect(workspace.runCommand).toHaveBeenCalledWith(
      'thread-1',
      'owner-1',
      'tenant-1',
      'npm test',
      30,
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({
      summary: 'Tests passed.',
      status: 'completed',
      steps: [
        {
          command: 'npm test',
          exitCode: 0,
          output: 'All tests passed.',
        },
      ],
      toolCalls: 1,
    });
    expect(workspace.startDevServer).not.toHaveBeenCalled();
  });

  it('resumes the requested task on the same run and preserves blocked loop status', async () => {
    const llm = { getAgenticModel: jest.fn() };
    const workspace = {
      startWorkspace: jest.fn(),
      assertWorkspaceReady: jest.fn().mockResolvedValue(undefined),
      isWorkspaceTaskLeaseActive: jest.fn().mockReturnValue(true),
    };
    const agentLoop = {
      resume: jest.fn().mockResolvedValue({
        status: 'blocked',
        state: { role: 'backend', instruction: '恢复任务', events: [] },
        steps: 2,
        toolCalls: 1,
        terminationReason: '需要人工确认',
      }),
      run: jest.fn(),
    };
    const service = new ProductionProjectWorkspaceAgentService(
      llm as never,
      agentLoop as never,
      workspace as never,
    );

    await expect(
      service.runWithExecutionOptions(
        'thread-1',
        'owner-1',
        'tenant-1',
        'artifact-1',
        '恢复任务',
        {
          runId: 'run-stable',
          taskId: 'task-stable',
          resume: true,
          role: 'backend',
          strictRole: true,
        },
      ),
    ).resolves.toMatchObject({
      summary: '需要人工确认',
      status: 'blocked',
      toolCalls: 1,
    });

    expect(workspace.assertWorkspaceReady).toHaveBeenCalledWith(
      'thread-1', 'owner-1', 'tenant-1', 'artifact-1', 'backend', 'code', true,
    );
    expect(workspace.startWorkspace).not.toHaveBeenCalled();
    expect(agentLoop.resume).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-stable',
        taskId: 'task-stable',
        actor: 'production-workspace-agent',
      }),
    );
    expect(agentLoop.run).not.toHaveBeenCalled();
  });

  it('preflights checkpoint eligibility without invoking the model', async () => {
    const llm = { getAgenticModel: jest.fn() };
    const workspace = {
      assertWorkspaceReady: jest.fn().mockResolvedValue(undefined),
    };
    const agentLoop = { assertCanResume: jest.fn().mockResolvedValue(undefined) };
    const service = new ProductionProjectWorkspaceAgentService(
      llm as never,
      agentLoop as never,
      workspace as never,
    );

    await service.assertCanResume(
      'thread-1',
      'owner-1',
      'tenant-1',
      'artifact-1',
      '恢复任务',
      {
        runId: 'run-stable',
        taskId: 'task-stable',
        role: 'backend',
        strictRole: true,
      },
    );

    expect(workspace.assertWorkspaceReady).toHaveBeenCalledWith(
      'thread-1', 'owner-1', 'tenant-1', 'artifact-1', 'backend', 'code', true,
    );

    expect(agentLoop.assertCanResume).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-stable', taskId: 'task-stable' }),
    );
    expect(llm.getAgenticModel).not.toHaveBeenCalled();
  });
});
