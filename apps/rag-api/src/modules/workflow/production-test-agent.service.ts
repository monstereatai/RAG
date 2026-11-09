import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { AgentLoopService } from '../agent-loop/agent-loop.service';
import type {
  AgentLoopDecision,
  AgentLoopInput,
  AgentLoopStatus,
} from '../agent-loop/agent-loop.types';
import { getPromptMetadata } from '../../rag/prompts/prompt-registry';
import { productionTestAgentPromptTemplate } from './production-test-agent.prompts';
import { ProductionProjectWorkspaceService } from './production-project-workspace.service';

const testAgentActionSchema = z.object({
  action: z.enum(['verify_workspace', 'complete']),
  summary: z.string().min(1).max(2_000),
  diagnosis: z.string().max(4_000),
  suggestedFixes: z.array(z.string().max(500)).max(10),
});

type WorkspaceVerification = Awaited<
  ReturnType<ProductionProjectWorkspaceService['verifyWorkspace']>
>;
type TestAgentState = {
  role: 'qa';
  task: 'verify';
  artifactId: string;
  instruction: string;
  verification: WorkspaceVerification | null;
  verificationLogs: WorkspaceVerification['checks'] | null;
};

export interface ProductionTestAgentReport {
  artifactId: string;
  artifactVersion: string;
  applicableChecks: Array<'lint' | 'test' | 'build'>;
  requiredChecks: Array<'lint' | 'test' | 'build'>;
  skippedChecks: Array<'lint' | 'test' | 'build'>;
  checks: Array<{
    name: 'lint' | 'test' | 'build';
    status: 'passed' | 'failed' | 'not_applicable' | 'not_run';
    exitCode: number | null;
    summary: string;
    outputTruncated: boolean;
    logPreview: string | null;
    logRef: string | null;
  }>;
  logsArtifactId: string | null;
  diagnosis: string;
  evidenceRefs: string[];
  suggestedFixes: string[];
  requiresHumanReview: true;
  status: 'passed' | 'failed' | 'incomplete' | 'not_run';
  summary: string;
  parentRunId: string | null;
  traceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionTestAgentOutput {
  status: AgentLoopStatus;
  summary: string;
  toolCalls: number;
  report: ProductionTestAgentReport | null;
  logs: WorkspaceVerification['checks'] | null;
}

const MAX_STEPS = 6;
const MAX_TOOL_CALLS = 4;
const TIMEOUT_MS = 5 * 60 * 1_000;
const LOG_PREVIEW_LIMIT = 1_500;

@Injectable()
export class ProductionTestAgentService {
  constructor(
    private readonly llmProvider: LlmProvider,
    private readonly agentLoop: AgentLoopService,
    private readonly workspace: ProductionProjectWorkspaceService,
    private readonly artifacts: ArtifactsService,
  ) {}

  async runWithExecutionOptions(input: {
    threadId: string;
    userId: string;
    tenantId?: string;
    artifactId: string;
    instruction: string;
    runId: string;
    taskId: string;
    parentRunId?: string;
    resume: boolean;
  }): Promise<ProductionTestAgentOutput> {
    const normalizedInstruction = input.instruction.trim();
    if (!normalizedInstruction || normalizedInstruction.length > 4_000) {
      throw new BadRequestException('instruction must be 1–4000 characters');
    }
    const artifact = await this.artifacts.getStudioVersion(
      input.artifactId,
      input.userId,
      input.threadId,
    );
    const metadata = this.parseMetadata(artifact.metadata);
    const artifactVersion = String(metadata.version ?? input.artifactId);
    const roleContext = {
      threadId: input.threadId,
      userId: input.userId,
      tenantId: input.tenantId,
      artifactId: input.artifactId,
      role: 'qa' as const,
      task: 'verify' as const,
      strictRole: true,
    };
    if (input.resume) {
      await this.workspace.assertWorkspaceReady(
        input.threadId,
        input.userId,
        input.tenantId,
        input.artifactId,
        'qa',
        'verify',
        true,
      );
    } else {
      await this.workspace.startWorkspace(
        input.threadId,
        input.userId,
        input.tenantId,
        input.artifactId,
        'qa',
        'verify',
        true,
      );
    }

    const loopInput: AgentLoopInput<TestAgentState, ProductionTestAgentReport> = {
      threadId: input.threadId,
      runId: input.runId,
      taskId: input.taskId,
      actor: 'production-test-agent',
      tenantId: input.tenantId,
      initialState: {
        role: 'qa',
        task: 'verify',
        artifactId: input.artifactId,
        instruction: normalizedInstruction,
        verification: null,
        verificationLogs: null,
      },
      maxSteps: MAX_STEPS,
      maxToolCalls: MAX_TOOL_CALLS,
      timeoutMs: TIMEOUT_MS,
      decide: async (state, context) => {
        const messages = [
          {
            role: 'system',
            content: productionTestAgentPromptTemplate,
          },
          {
            role: 'user',
            content: JSON.stringify({
              role: state.role,
              task: state.task,
              artifactId: state.artifactId,
              instruction: state.instruction,
              verification: state.verification,
            }),
          },
        ];
        const decision = await this.llmProvider
          .getAgenticModel()
          .withStructuredOutput(testAgentActionSchema, { method: 'jsonMode' })
          .invoke(messages, {
            signal: context.signal,
            metadata: getPromptMetadata('workflow.test_agent'),
          });

        if (decision.action === 'verify_workspace') {
          if (state.verification || context.toolCalls > 0) {
            return {
              type: 'blocked',
              reason: 'workspace verification already ran; repeated checks are blocked',
            } satisfies AgentLoopDecision<TestAgentState, ProductionTestAgentReport>;
          }
          const idempotencyKey = createHash('sha256')
            .update(
              `${input.tenantId ?? 'legacy'}\0${input.userId}\0${input.threadId}\0${input.taskId}\0${input.artifactId}\0verify_workspace`,
            )
            .digest('hex');
          return {
            type: 'tool',
            name: 'workspace_verify',
            mode: 'production',
            role: 'qa',
            ownerUserId: input.userId,
            approvalPolicy: 'auto',
            allowedToolNames: ['workspace_verify'],
            input: {
              artifactId: input.artifactId,
              checks: ['lint', 'test', 'build'],
            },
            idempotencyKey,
            sideEffect: true,
            preserveFullOutput: true,
            execute: (signal) =>
              this.workspace.verifyWorkspace(
                roleContext.threadId,
                roleContext.userId,
                roleContext.tenantId,
                roleContext.artifactId,
                signal,
                'qa',
                'verify',
                true,
              ),
            reduce: (current, output) => ({
              ...current,
              verification: this.limitVerification(output as WorkspaceVerification),
              verificationLogs: (output as WorkspaceVerification).checks,
            }),
          } satisfies AgentLoopDecision<TestAgentState, ProductionTestAgentReport>;
        }

        if (!state.verification) {
          return {
            type: 'blocked',
            reason: 'workspace verification is required before QA completion',
          } satisfies AgentLoopDecision<TestAgentState, ProductionTestAgentReport>;
        }

        const report = this.buildReport({
          verification: state.verification,
          artifactId: input.artifactId,
          artifactVersion,
          parentRunId: input.parentRunId ?? null,
          traceId: input.runId,
          summary: decision.summary,
          diagnosis: decision.diagnosis,
          suggestedFixes: decision.suggestedFixes,
        });
        return {
          type: 'complete',
          output: report,
          reason: 'QA report completed from workspace check evidence',
        } satisfies AgentLoopDecision<TestAgentState, ProductionTestAgentReport>;
      },
    };

    const result = input.resume
      ? await this.agentLoop.resume<TestAgentState, ProductionTestAgentReport>(
          loopInput,
        )
      : await this.agentLoop.run<TestAgentState, ProductionTestAgentReport>(
          loopInput,
        );
    if (result.output) {
      return {
        status: 'completed',
        summary: result.output.summary,
        toolCalls: result.toolCalls,
        report: result.output,
        logs: result.state.verificationLogs ?? null,
      };
    }
    const verification = result.state.verification;
    return {
      status: result.status,
      summary: result.terminationReason,
      toolCalls: result.toolCalls,
      logs: result.state.verificationLogs ?? null,
      report: verification
        ? this.buildReport({
            verification,
            artifactId: input.artifactId,
            artifactVersion,
            parentRunId: input.parentRunId ?? null,
            traceId: input.runId,
            summary: '检查已执行，QA Agent 未能完成诊断。',
            diagnosis: result.terminationReason,
            suggestedFixes: [],
          })
        : null,
    };
  }

  async assertCanResume(input: {
    threadId: string;
    userId: string;
    tenantId?: string;
    artifactId: string;
    instruction: string;
    runId: string;
    taskId: string;
  }): Promise<void> {
    const normalizedInstruction = input.instruction.trim();
    if (!normalizedInstruction || normalizedInstruction.length > 4_000) {
      throw new BadRequestException('instruction must be 1–4000 characters');
    }
    await this.workspace.assertWorkspaceReady(
      input.threadId,
      input.userId,
      input.tenantId,
      input.artifactId,
      'qa',
      'verify',
      true,
    );
    await this.agentLoop.assertCanResume({
      threadId: input.threadId,
      runId: input.runId,
      taskId: input.taskId,
      actor: 'production-test-agent',
      tenantId: input.tenantId,
      initialState: {
        role: 'qa',
        task: 'verify',
        artifactId: input.artifactId,
        instruction: normalizedInstruction,
        verification: null,
        verificationLogs: null,
      },
      maxSteps: MAX_STEPS,
      maxToolCalls: MAX_TOOL_CALLS,
      timeoutMs: TIMEOUT_MS,
      decide: () => ({ type: 'blocked', reason: 'resume preflight only' }),
    });
  }

  private limitVerification(value: WorkspaceVerification): WorkspaceVerification {
    return {
      checkedAt: value.checkedAt,
      diff: {
        added: value.diff.added.slice(0, 100),
        modified: value.diff.modified.slice(0, 100),
        deleted: value.diff.deleted.slice(0, 100),
      },
      checks: Object.fromEntries(
        Object.entries(value.checks).map(([name, check]) => [
          name,
          {
            ...check,
            output: check.output.slice(-LOG_PREVIEW_LIMIT),
            reason: check.reason?.slice(0, 500),
          },
        ]),
      ) as WorkspaceVerification['checks'],
    };
  }

  private buildReport(input: {
    verification: WorkspaceVerification;
    artifactId: string;
    artifactVersion: string;
    parentRunId: string | null;
    traceId: string;
    summary: string;
    diagnosis: string;
    suggestedFixes: string[];
  }): ProductionTestAgentReport {
    const names = ['lint', 'test', 'build'] as const;
    const checks = names.map((name) => {
      const check = input.verification.checks[name];
      return {
        name,
        status: check.status,
        exitCode: check.exitCode,
        summary: [check.reason, check.output]
          .filter(Boolean)
          .join('\n')
          .slice(-LOG_PREVIEW_LIMIT),
        outputTruncated: check.outputTruncated === true,
        logPreview: check.outputTruncated
          ? [check.reason, check.output].filter(Boolean).join('\n').slice(-LOG_PREVIEW_LIMIT)
          : null,
        logRef: null,
      };
    });
    const requiredChecks = [...names];
    const applicableChecks = checks
      .filter((check) => check.status !== 'not_applicable')
      .map((check) => check.name);
    const skippedChecks = checks
      .filter((check) => check.status === 'not_applicable')
      .map((check) => check.name);
    const hasFailure = checks.some((check) => check.status === 'failed');
    const hasAnyRun = checks.some(
      (check) => check.status === 'passed' || check.status === 'failed',
    );
    const allRequiredChecksPassed = requiredChecks.every((name) =>
      checks.some((check) => check.name === name && check.status === 'passed'),
    );
    const status = hasFailure
      ? 'failed'
      : allRequiredChecksPassed
        ? 'passed'
        : hasAnyRun
          ? 'incomplete'
          : 'not_run';
    const now = new Date().toISOString();
    return {
      artifactId: input.artifactId,
      artifactVersion: input.artifactVersion,
      applicableChecks,
      requiredChecks,
      skippedChecks,
      checks,
      logsArtifactId: null,
      diagnosis: input.diagnosis.slice(0, 4_000),
      evidenceRefs: checks
        .filter((check) => check.logRef)
        .map((check) => check.logRef!),
      suggestedFixes: input.suggestedFixes.slice(0, 10),
      requiresHumanReview: true,
      status,
      summary: input.summary.slice(0, 2_000),
      parentRunId: input.parentRunId,
      traceId: input.traceId,
      createdAt: now,
      updatedAt: now,
    };
  }

  private parseMetadata(raw: string | null): Record<string, unknown> {
    try {
      const value = JSON.parse(raw ?? '{}') as unknown;
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}
