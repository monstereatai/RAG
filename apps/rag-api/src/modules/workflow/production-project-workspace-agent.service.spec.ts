import { ProductionProjectWorkspaceAgentService } from './production-project-workspace-agent.service';

describe('ProductionProjectWorkspaceAgentService', () => {
  it('runs arbitrary project commands only through the registered workspace tool', async () => {
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
      run: jest.fn(async (input: any) => {
        const signal = new AbortController().signal;
        let state = input.initialState;
        const toolDecision = await input.decide(state, {
          step: 0,
          toolCalls: 0,
          remainingMs: 480_000,
          signal,
        });
        expect(toolDecision.type).toBe('tool');
        expect(toolDecision.name).toBe('workspace_agent_command');
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
        expect(completion.type).toBe('complete');
        return {
          status: 'completed',
          state,
          output: completion.output,
          steps: 2,
          toolCalls: 1,
          terminationReason: completion.reason,
        };
      }),
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
    );

    expect(workspace.startWorkspace).toHaveBeenCalledWith(
      'thread-1',
      'owner-1',
      'tenant-1',
      'artifact-1',
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
});
