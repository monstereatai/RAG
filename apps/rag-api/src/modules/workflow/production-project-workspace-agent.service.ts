import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { AgentLoopService } from '../agent-loop/agent-loop.service';
import type {
  AgentLoopDecision,
  AgentLoopInput,
  AgentLoopStatus,
} from '../agent-loop/agent-loop.types';
import { ProductionProjectWorkspaceService } from './production-project-workspace.service';
import { getPromptMetadata } from '../../rag/prompts/prompt-registry';
import { buildProductionProjectWorkspaceAgentPrompt } from './production-project-workspace-agent.prompts';

const workspaceActionSchema = z.object({
  action: z.enum([
    'command',
    'start_dev_server',
    'stop_dev_server',
    'complete',
  ]),
  command: z.string().max(2_000).optional(),
  timeoutSeconds: z.number().int().min(1).max(240).optional(),
  port: z.number().int().min(1_024).max(65_535).optional(),
  serverCommand: z.string().max(500).optional(),
  summary: z.string().max(2_000),
});

type WorkspaceAction = z.infer<typeof workspaceActionSchema>;
type WorkspaceAgentEvent = {
  action: WorkspaceAction['action'];
  command: string;
  exitCode: number;
  detail: string;
  output: string;
};
type WorkspaceAgentState = {
  role: 'frontend' | 'backend';
  instruction: string;
  events: WorkspaceAgentEvent[];
};
type WorkspaceAgentOutput = {
  summary: string;
  status: AgentLoopStatus;
  steps: Array<{ command: string; exitCode: number; output: string }>;
  toolCalls: number;
};
type WorkspaceActionResult = {
  action: WorkspaceAction['action'];
  command: string;
  exitCode: number;
  detail: string;
  output: string;
};

const MAX_AGENT_STEPS = 10;
const MAX_AGENT_TOOL_CALLS = 8;
const AGENT_TIMEOUT_MS = 8 * 60 * 1_000;
const EVENT_OUTPUT_LIMIT = 2_500;

@Injectable()
export class ProductionProjectWorkspaceAgentService {
  constructor(
    private readonly llmProvider: LlmProvider,
    private readonly agentLoop: AgentLoopService,
    private readonly workspace: ProductionProjectWorkspaceService,
  ) {}

  async run(
    threadId: string,
    userId: string,
    tenantId: string | undefined,
    artifactId: string,
    instruction: string,
    options?: {
      runId?: string;
      taskId?: string;
      resume?: boolean;
      role?: 'frontend' | 'backend';
      strictRole?: boolean;
    },
  ): Promise<WorkspaceAgentOutput> {
    const normalizedInstruction = instruction.trim();
    if (!normalizedInstruction || normalizedInstruction.length > 4_000) {
      throw new BadRequestException('instruction must be 1–4000 characters');
    }

    const role = options?.role ?? 'frontend';
    if (options?.resume) {
      await this.workspace.assertWorkspaceReady(
        threadId,
        userId,
        tenantId,
        artifactId,
        role,
        'code',
        options?.strictRole ?? false,
      );
    } else {
      await this.workspace.startWorkspace(
        threadId,
        userId,
        tenantId,
        artifactId,
        role,
        'code',
        options?.strictRole ?? false,
      );
    }

    const runId = options?.runId ?? randomUUID();
    const loopInput: AgentLoopInput<
      WorkspaceAgentState,
      WorkspaceAgentOutput
    > = {
      threadId,
      runId,
      taskId: options?.taskId,
      actor: 'production-workspace-agent',
      tenantId,
      initialState: { role, instruction: normalizedInstruction, events: [] },
      maxSteps: MAX_AGENT_STEPS,
      maxToolCalls: MAX_AGENT_TOOL_CALLS,
      timeoutMs: AGENT_TIMEOUT_MS,
      decide: async (state, { signal }) => {
        const messages = [
          {
            role: 'system',
            content:
              buildProductionProjectWorkspaceAgentPrompt(MAX_AGENT_TOOL_CALLS, role),
          },
          {
            role: 'user',
            content: `执行岗位：${state.role}\n用户任务：\n${state.instruction}\n\n最近执行记录：\n${this.historyText(state.events)}\n\n请输出下一步动作。若还没有查看项目结构或 package scripts，应先查看。`,
          },
        ];
        const decision = await this.llmProvider
          .getAgenticModel()
          .withStructuredOutput(workspaceActionSchema, { method: 'jsonMode' })
          .invoke(messages, {
            signal,
            metadata: getPromptMetadata('workflow.workspace_agent'),
          });

        if (decision.action === 'complete') {
          return {
            type: 'complete',
            output: {
              summary: decision.summary,
              status: 'completed',
              steps: state.events.map(({ command, exitCode, output }) => ({
                command,
                exitCode,
                output,
              })),
              toolCalls: state.events.length,
            },
            reason: 'workspace agent completed the user request',
          } satisfies AgentLoopDecision<
            WorkspaceAgentState,
            WorkspaceAgentOutput
          >;
        }

        if (decision.action === 'command' && !decision.command?.trim()) {
          return {
            type: 'blocked',
            reason: 'workspace agent returned an empty command',
          } satisfies AgentLoopDecision<
            WorkspaceAgentState,
            WorkspaceAgentOutput
          >;
        }
        if (
          decision.action === 'start_dev_server' &&
          (!decision.port || decision.port < 1_024 || decision.port > 65_535)
        ) {
          return {
            type: 'blocked',
            reason:
              'workspace agent returned an invalid development server port',
          } satisfies AgentLoopDecision<
            WorkspaceAgentState,
            WorkspaceAgentOutput
          >;
        }

        const action = decision;
        const idempotencyKey = createHash('sha256')
          .update(`${threadId}\0${userId}\0${runId}\0${state.role}\0${state.events.length}`)
          .digest('hex');
        return {
          type: 'tool',
          name: 'workspace_agent_command',
          mode: 'production',
          role: state.role,
          ownerUserId: userId,
          approvalPolicy: 'auto',
          allowedToolNames: ['workspace_agent_command'],
          input: {
            action: action.action,
            command: action.command,
            port: action.port,
            serverCommand: action.serverCommand,
          },
          idempotencyKey,
          sideEffect: true,
          preserveFullOutput: true,
          execute: async (signal) =>
            this.executeAction(threadId, userId, tenantId, action, signal),
          reduce: (current, output) => ({
            ...current,
            events: [
              ...current.events,
              this.toEvent(output as WorkspaceActionResult),
            ].slice(-MAX_AGENT_TOOL_CALLS),
          }),
        } satisfies AgentLoopDecision<
          WorkspaceAgentState,
          WorkspaceAgentOutput
        >;
      },
    };
    const result = options?.resume
      ? await this.agentLoop.resume<WorkspaceAgentState, WorkspaceAgentOutput>(loopInput)
      : await this.agentLoop.run<WorkspaceAgentState, WorkspaceAgentOutput>(loopInput);

    if (result.output) return result.output;
    return {
      summary: result.terminationReason,
      status: result.status,
      steps: result.state.events.map(({ command, exitCode, output }) => ({
        command,
        exitCode,
        output,
      })),
      toolCalls: result.toolCalls,
    };
  }

  async runWithExecutionOptions(
    threadId: string,
    userId: string,
    tenantId: string | undefined,
    artifactId: string,
    instruction: string,
    options: {
      runId: string;
      taskId: string;
      resume: boolean;
      role?: 'frontend' | 'backend';
      strictRole?: boolean;
    },
  ): Promise<WorkspaceAgentOutput> {
    return this.run(threadId, userId, tenantId, artifactId, instruction, options);
  }

  async assertCanResume(
    threadId: string,
    userId: string,
    tenantId: string | undefined,
    artifactId: string,
    instruction: string,
    options: {
      runId: string;
      taskId: string;
      role?: 'frontend' | 'backend';
      strictRole?: boolean;
    },
  ): Promise<void> {
    const normalizedInstruction = instruction.trim();
    if (!normalizedInstruction || normalizedInstruction.length > 4_000) {
      throw new BadRequestException('instruction must be 1–4000 characters');
    }
    await this.workspace.assertWorkspaceReady(
      threadId,
      userId,
      tenantId,
      artifactId,
      options.role ?? 'frontend',
      'code',
      options.strictRole ?? false,
    );
    await this.agentLoop.assertCanResume({
      threadId,
      runId: options.runId,
      taskId: options.taskId,
      actor: 'production-workspace-agent',
      tenantId,
      initialState: {
        role: options.role ?? 'frontend',
        instruction: normalizedInstruction,
        events: [],
      },
      maxSteps: MAX_AGENT_STEPS,
      maxToolCalls: MAX_AGENT_TOOL_CALLS,
      timeoutMs: AGENT_TIMEOUT_MS,
      decide: () => ({ type: 'blocked', reason: 'resume preflight only' }),
    });
  }

  private async executeAction(
    threadId: string,
    userId: string,
    tenantId: string | undefined,
    action: WorkspaceAction,
    signal?: AbortSignal,
  ): Promise<WorkspaceActionResult> {
    if (action.action === 'command') {
      const result = await this.workspace.runCommand(
        threadId,
        userId,
        tenantId,
        action.command!.trim(),
        action.timeoutSeconds ?? 120,
        signal,
      );
      return {
        action: action.action,
        command: action.command!.trim(),
        exitCode: result.exitCode ?? -1,
        detail: `exitCode=${result.exitCode ?? 'unknown'}, timedOut=${result.timedOut}`,
        output: result.output,
      };
    }
    if (action.action === 'start_dev_server') {
      const result = await this.workspace.startDevServer(
        threadId,
        userId,
        tenantId,
        { port: action.port!, command: action.serverCommand },
      );
      return {
        action: action.action,
        command:
          action.serverCommand ?? `start dev server on port ${result.port}`,
        exitCode: 0,
        detail: `port=${result.port}, status=${result.status}`,
        output: result.commandId,
      };
    }
    if (action.action === 'stop_dev_server') {
      const result = await this.workspace.stopDevServer(
        threadId,
        userId,
        tenantId,
      );
      return {
        action: action.action,
        command: 'stop dev server',
        exitCode: result.stopped ? 0 : -1,
        detail: `stopped=${result.stopped}`,
        output: '',
      };
    }
    return {
      action: action.action,
      command: '',
      exitCode: 0,
      detail: action.summary,
      output: '',
    };
  }

  private toEvent(result: WorkspaceActionResult): WorkspaceAgentEvent {
    return {
      action: result.action,
      command: result.command.slice(0, 2_000),
      exitCode: result.exitCode,
      detail: result.detail.slice(0, 500),
      output: result.output.slice(0, EVENT_OUTPUT_LIMIT),
    };
  }

  private historyText(events: WorkspaceAgentEvent[]): string {
    if (!events.length) return '尚无命令执行记录';
    return events
      .map(
        (event, index) =>
          `${index + 1}. ${event.action}: ${event.detail}\n命令：${event.command}\n${event.output}`,
      )
      .join('\n\n')
      .slice(-20_000);
  }
}
