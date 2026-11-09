import type { AgentLoopInput } from '../agent-loop/agent-loop.types';
import { ProductionTestAgentService } from './production-test-agent.service';

type QaState = {
  role: 'qa';
  task: 'verify';
  artifactId: string;
  instruction: string;
  verification: unknown;
};

describe('ProductionTestAgentService', () => {
  function setup(decisions: Array<Record<string, unknown>>) {
    const instructionModel = {
      invoke: jest.fn().mockImplementation(async () => {
        const decision = decisions.shift();
        if (!decision) throw new Error('No QA decision configured');
        return decision;
      }),
    };
    const llm = {
      getAgenticModel: jest.fn(() => ({
        withStructuredOutput: jest.fn(() => instructionModel),
      })),
    };
    const verification = {
      checkedAt: new Date().toISOString(),
      diff: { added: [], modified: [], deleted: [] },
      checks: {
        lint: {
          status: 'passed',
          command: 'npm run lint',
          exitCode: 0,
          output: 'clean',
        },
        test: {
          status: 'passed',
          command: 'npm run test',
          exitCode: 0,
          output: 'suite passed',
        },
        build: {
          status: 'passed',
          command: 'npm run build',
          exitCode: 0,
          output: 'built',
        },
      },
    };
    const workspace = {
      startWorkspace: jest.fn().mockResolvedValue({ ready: true }),
      assertWorkspaceReady: jest.fn().mockResolvedValue(undefined),
      verifyWorkspace: jest.fn().mockResolvedValue(verification),
    };
    const artifacts = {
      getStudioVersion: jest.fn().mockResolvedValue({
        id: 'artifact-1',
        metadata: JSON.stringify({ version: 2 }),
      }),
    };
    const agentLoop = {
      run: jest.fn(
        async (
          input: AgentLoopInput<QaState, Record<string, unknown>>,
        ) => {
          const signal = new AbortController().signal;
          let state = input.initialState;
          const verify = await input.decide(state, {
            step: 0,
            toolCalls: 0,
            remainingMs: 300_000,
            signal,
          });
          if (verify.type !== 'tool') {
            throw new Error('QA agent must run the bounded verification tool first');
          }
          expect(verify.name).toBe('workspace_verify');
          expect(verify.role).toBe('qa');
          expect(verify.allowedToolNames).toEqual(['workspace_verify']);
          const checkResult = await verify.execute(signal);
          state = verify.reduce(state, checkResult);
          const finish = await input.decide(state, {
            step: 1,
            toolCalls: 1,
            remainingMs: 299_000,
            signal,
          });
          if (finish.type !== 'complete') {
            return {
              status: 'blocked',
              state,
              steps: 2,
              toolCalls: 1,
              terminationReason: finish.type === 'blocked' ? finish.reason : 'unexpected',
            };
          }
          return {
            status: 'completed',
            state,
            output: finish.output,
            steps: 2,
            toolCalls: 1,
            terminationReason: finish.reason,
          };
        },
      ),
      resume: jest.fn(),
      assertCanResume: jest.fn(),
    };
    const service = new ProductionTestAgentService(
      llm as never,
      agentLoop as never,
      workspace as never,
      artifacts as never,
    );
    return { service, llm, instructionModel, workspace, artifacts, agentLoop, verification };
  }

  it('uses only fixed QA checks and creates a human review report from their evidence', async () => {
    const { service, workspace, agentLoop } = setup([
      {
        action: 'verify_workspace',
        summary: '执行项目检查',
        diagnosis: '',
        suggestedFixes: [],
      },
      {
        action: 'complete',
        summary: '三个固定检查通过',
        diagnosis: '未发现问题',
        suggestedFixes: [],
      },
    ]);

    const output = await service.runWithExecutionOptions({
      threadId: 'thread-1',
      userId: 'owner-1',
      tenantId: 'tenant-1',
      artifactId: 'artifact-1',
      instruction: '验证 lint、测试和构建',
      runId: 'qa-run-1',
      taskId: 'qa-task-1',
      parentRunId: 'workflow-run-1',
      resume: false,
    });

    expect(workspace.startWorkspace).toHaveBeenCalledWith(
      'thread-1',
      'owner-1',
      'tenant-1',
      'artifact-1',
      'qa',
      'verify',
      true,
    );
    expect(workspace.verifyWorkspace).toHaveBeenCalledWith(
      'thread-1',
      'owner-1',
      'tenant-1',
      'artifact-1',
      expect.any(AbortSignal),
      'qa',
      'verify',
      true,
    );
    expect(agentLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({ maxSteps: 6, maxToolCalls: 4, timeoutMs: 300_000 }),
    );
    expect(output).toMatchObject({
      status: 'completed',
      report: {
        artifactId: 'artifact-1',
        artifactVersion: '2',
        status: 'passed',
        requiresHumanReview: true,
        parentRunId: 'workflow-run-1',
        traceId: 'qa-run-1',
        checks: [
          { name: 'lint', status: 'passed', exitCode: 0 },
          { name: 'test', status: 'passed', exitCode: 0 },
          { name: 'build', status: 'passed', exitCode: 0 },
        ],
      },
    });
  });

  it('blocks repeated verification and does not claim completion without evidence', async () => {
    const { service, workspace, agentLoop, instructionModel } = setup([
      {
        action: 'verify_workspace',
        summary: '第一次检查',
        diagnosis: '',
        suggestedFixes: [],
      },
      {
        action: 'verify_workspace',
        summary: '重复检查',
        diagnosis: '',
        suggestedFixes: [],
      },
    ]);
    agentLoop.run.mockImplementationOnce(
      async (input: AgentLoopInput<QaState, Record<string, unknown>>) => {
        const signal = new AbortController().signal;
        let state = input.initialState;
        const first = await input.decide(state, {
          step: 0,
          toolCalls: 0,
          remainingMs: 300_000,
          signal,
        });
        if (first.type !== 'tool') throw new Error('Expected one QA tool call');
        state = first.reduce(state, await first.execute(signal));
        const repeated = await input.decide(state, {
          step: 1,
          toolCalls: 1,
          remainingMs: 299_000,
          signal,
        });
        expect(repeated).toMatchObject({ type: 'blocked' });
        return {
          status: 'blocked',
          state,
          steps: 2,
          toolCalls: 1,
          terminationReason: repeated.type === 'blocked' ? repeated.reason : '',
        };
      },
    );

    const output = await service.runWithExecutionOptions({
      threadId: 'thread-1',
      userId: 'owner-1',
      artifactId: 'artifact-1',
      instruction: '仅检查一次',
      runId: 'qa-run-2',
      taskId: 'qa-task-2',
      resume: false,
    });

    expect(workspace.verifyWorkspace).toHaveBeenCalledTimes(1);
    expect(instructionModel.invoke).toHaveBeenCalledTimes(2);
    expect(output.status).toBe('blocked');
    expect(output.report).toMatchObject({
      status: 'passed',
      requiresHumanReview: true,
    });
  });

  it('keeps a failed check failed in the generated report', async () => {
    const { service, workspace, verification } = setup([
      {
        action: 'verify_workspace',
        summary: '运行验证',
        diagnosis: '',
        suggestedFixes: [],
      },
      {
        action: 'complete',
        summary: '测试失败',
        diagnosis: '测试断言不匹配',
        suggestedFixes: ['修正预期状态'],
      },
    ]);
    workspace.verifyWorkspace.mockResolvedValue({
      ...verification,
      checks: {
        ...verification.checks,
        test: {
          status: 'failed',
          command: 'npm run test',
          exitCode: 1,
          output: 'Expected accepted, received failed',
        },
      },
    });

    const output = await service.runWithExecutionOptions({
      threadId: 'thread-1',
      userId: 'owner-1',
      artifactId: 'artifact-1',
      instruction: '定位测试失败',
      runId: 'qa-run-failed',
      taskId: 'qa-task-failed',
      resume: false,
    });

    expect(output.report).toMatchObject({
      status: 'failed',
      checks: [
        { name: 'lint', status: 'passed' },
        {
          name: 'test',
          status: 'failed',
          exitCode: 1,
          summary: 'Expected accepted, received failed',
        },
        { name: 'build', status: 'passed', exitCode: 0 },
      ],
      diagnosis: '测试断言不匹配',
      suggestedFixes: ['修正预期状态'],
      requiresHumanReview: true,
    });
  });

  it.each([
    {
      name: 'only lint is available',
      statuses: ['passed', 'not_applicable', 'not_applicable'],
      reportStatus: 'incomplete',
      applicableChecks: ['lint'],
      skippedChecks: ['test', 'build'],
    },
    {
      name: 'only test is available',
      statuses: ['not_applicable', 'passed', 'not_applicable'],
      reportStatus: 'incomplete',
      applicableChecks: ['test'],
      skippedChecks: ['lint', 'build'],
    },
    {
      name: 'all checks are unavailable',
      statuses: ['not_applicable', 'not_applicable', 'not_applicable'],
      reportStatus: 'not_run',
      applicableChecks: [],
      skippedChecks: ['lint', 'test', 'build'],
    },
    {
      name: 'verification is interrupted after lint',
      statuses: ['passed', 'not_run', 'not_run'],
      reportStatus: 'incomplete',
      applicableChecks: ['lint', 'test', 'build'],
      skippedChecks: [],
    },
  ])(
    'does not pass when $name',
    async ({ statuses, reportStatus, applicableChecks, skippedChecks }) => {
      const { service, workspace, verification } = setup([
        {
          action: 'verify_workspace',
          summary: '执行检查',
          diagnosis: '',
          suggestedFixes: [],
        },
        {
          action: 'complete',
          summary: '检查结果',
          diagnosis: '',
          suggestedFixes: [],
        },
      ]);
      const names = ['lint', 'test', 'build'] as const;
      workspace.verifyWorkspace.mockResolvedValue({
        ...verification,
        checks: Object.fromEntries(
          names.map((name, index) => [
            name,
            {
              status: statuses[index],
              command: statuses[index] === 'not_applicable' ? null : `npm run ${name}`,
              exitCode: statuses[index] === 'passed' ? 0 : null,
              output: statuses[index] === 'passed' ? `${name} passed` : '',
              reason:
                statuses[index] === 'not_applicable'
                  ? 'package.json 未声明脚本。'
                  : undefined,
            },
          ]),
        ) as never,
      });

      const output = await service.runWithExecutionOptions({
        threadId: 'thread-1',
        userId: 'owner-1',
        artifactId: 'artifact-1',
        instruction: '检查所有质量门禁',
        runId: 'qa-run-incomplete',
        taskId: 'qa-task-incomplete',
        resume: false,
      });

      expect(output.report).toMatchObject({
        status: reportStatus,
        applicableChecks,
        requiredChecks: ['lint', 'test', 'build'],
        skippedChecks,
      });
    },
  );
});
