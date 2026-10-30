import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { ArtifactsService } from '../artifacts/artifacts.service';
import {
  PRODUCTION_ROLES,
  ProductionClaim,
  ProductionRole,
  ProductionRiskLevel,
} from './production-workflow.state';
import { ProductionWorkflowTools } from './production-workflow.tools';
import { LangfuseProvider } from '../../providers/observability/langfuse.provider';
import { DingTalkProvider } from '../../providers/notify/dingtalk.provider';
import { AgentCollaborationService } from '../agent-collaboration/agent-collaboration.service';
import { AgentTasksService } from '../agent-tasks/agent-tasks.service';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';
import { ToolExecutionPolicyService } from '../../tools/tool-execution-policy.service';
import { ToolExecutionService } from '../../tools/tool-execution.service';
import { AgentRunsService } from '../agent-runs/agent-runs.service';
import { AgentGoalService } from '../agent-runs/agent-goal.service';
import { PluginRuntimeService } from '../plugin-runtime/plugin-runtime.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { ProductionWorkflowQueueService } from './production-workflow-queue.service';
import type { ProductionWorkflowJob } from './production-workflow-queue.service';

export interface ProductionWorkflowDependencies {
  llmProvider: LlmProvider;
  redisProvider: RedisProvider;
  roleTools: ProductionWorkflowTools;
  artifacts: ArtifactsService;
  langfuseProvider?: LangfuseProvider;
  collaboration?: AgentCollaborationService;
  tasks?: AgentTasksService;
  runtimeEvents?: AgentRuntimeEventsService;
  toolPolicy?: ToolExecutionPolicyService;
  toolExecution?: ToolExecutionService;
  agentRuns?: AgentRunsService;
  agentGoals?: AgentGoalService;
  plugins?: PluginRuntimeService;
  domainEvents?: DomainEventsService;
  dingTalk?: DingTalkProvider;
  workflowQueue?: ProductionWorkflowQueueService;
  configService?: ConfigService;
}

export const roleSchema = z.object({
  summary: z.string().min(1).max(4_000),
  deliverables: z
    .array(
      z.object({
        type: z.string().min(1).max(64),
        title: z.string().min(1).max(256),
        markdown: z.string().min(20).max(30_000),
      }),
    )
    .min(1)
    .max(4),
  claims: z
    .array(
      z.object({
        statement: z.string().min(1).max(2_000),
        evidenceIds: z.array(z.string().min(1)).max(8),
        status: z.enum(['supported', 'pending_confirmation']),
      }),
    )
    .max(20),
  issues: z.array(z.string().min(1)).max(12),
  downstreamRisks: z.array(z.string().min(1)).max(12),
  riskLevel: z.enum(['low', 'medium', 'high']),
  readyForApproval: z.boolean(),
  lowCodeSchemas: z
    .array(
      z.object({
        schemaVersion: z.literal(1),
        role: z.enum(PRODUCTION_ROLES),
        kind: z.enum([
          'pageSchema',
          'apiSchema',
          'trackingSchema',
          'validationSchema',
          'acceptanceSchema',
        ]),
        title: z.string().min(1).max(256),
        source: z.enum(['llm', 'fallback']).optional(),
        components: z.array(z.record(z.string(), z.unknown())).optional(),
        apis: z.array(z.record(z.string(), z.unknown())).optional(),
        events: z.array(z.record(z.string(), z.unknown())).optional(),
        rules: z.array(z.record(z.string(), z.unknown())).optional(),
        checks: z.array(z.record(z.string(), z.unknown())).optional(),
        notes: z.array(z.string().max(500)).optional(),
      }),
    )
    .max(8)
    .optional(),
});

export const WORKFLOW_INPUT_SAFETY_RATIO = 0.1;

export const WORKFLOW_MIN_INPUT_SAFETY_TOKENS = 256;

export const WORKFLOW_EVIDENCE_EXCERPT_CHAR_BUDGET = 1_200;

export interface ProductionPreviousRoleContext {
  role: ProductionRole;
  summary: string;
  deliverables: Array<{ type: string; title: string; markdownExcerpt: string }>;
  claims: ProductionClaim[];
  issues: string[];
  downstreamRisks: string[];
  riskLevel: ProductionRiskLevel;
}

export const projectFileSchema = z.object({
  path: z
    .string()
    .regex(/^[A-Za-z0-9_.\-/]+$/)
    .max(180),
  content: z.string().max(80_000),
  purpose: z.string().max(500),
});

export const projectSchema = z.object({
  projectName: z.string().min(1).max(120),
  framework: z.string().min(1).max(120),
  files: z.array(projectFileSchema).min(3).max(30),
  runCommand: z.string().min(1).max(300),
  notes: z.array(z.string().max(500)).max(12),
});

export const RISK_RANK: Record<ProductionRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export const ROLE_LLM_TIMEOUT_MS = 75_000;

export const ROLE_LLM_RETRY_BACKOFF_MS = 1_000;

export const WORKFLOW_CANCEL_MARKER_TTL_SECONDS = 24 * 60 * 60;

export interface WorkflowApprovalCheckpointIdentity {
  runId: string;
  batchIndex: number;
  stepCount: number;
  revisionNumber: number;
  currentBatch: ProductionRole[];
  pendingApprovalRoles: ProductionRole[];
}

export type ResumeWorkflowJobWithCheckpoint = Extract<
  ProductionWorkflowJob,
  { operation: 'resume' }
> & {
  approvalCheckpointIdentity: WorkflowApprovalCheckpointIdentity;
};

export class ProductionWorkflowCancelledError extends Error {
  constructor(message = '用户取消工作流') {
    super(message);
    this.name = 'ProductionWorkflowCancelledError';
  }
}
