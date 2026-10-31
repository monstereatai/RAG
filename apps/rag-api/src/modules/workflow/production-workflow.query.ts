import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import {
  ProductionEvidence,
  ProductionStageResult,
  ProductionWorkflowStateType,
} from './production-workflow.state';
import { renderPlaywayPreview } from './playway-preview';
import {
  executeWithToolTimeout,
  getRegisteredToolTimeoutMs,
} from '../../tools/tool-execution.service';
import { projectSchema } from './production-workflow.shared';
import { ProductionWorkflowControlBase } from './production-workflow.control';
import { getPromptMetadata } from '../../rag/prompts/prompt-registry';
import { productionProjectGenerationPromptDefinitions } from './production-project-generation.prompts';

export abstract class ProductionWorkflowQueryBase extends ProductionWorkflowControlBase {
  async status(threadId: string, userId: string, tenantId?: string) {
    let state: ProductionWorkflowStateType;
    try {
      state = await this.getOwnedState(threadId, userId, tenantId);
    } catch (error) {
      const pending = this.pendingStates.get(threadId);
      if (
        !pending ||
        pending.userId !== userId ||
        !this.tenantMatches(pending.tenantId, tenantId)
      )
        throw error;
      state = pending;
    }
    // 持久队列启用后由 BullMQ Worker 推进，状态查询不能再抢占为本进程执行，
    // 否则会与 Worker 产生同一 Checkpoint 的并发推进。
    if (
      state.status === 'running' &&
      !this.activeRuns.has(threadId) &&
      !this.workflowQueue?.isEnabled() &&
      !this.workflowQueue?.isRequired?.()
    ) {
      this.schedule(threadId, userId, () =>
        this.runUntilSettled(threadId, state),
      );
    }
    const result = this.view(threadId, state, userId);
    void this.saveWorkflowIndexBestEffort(result);
    return result;
  }

  async list(userId: string, tenantId?: string) {
    const ids = await this.redisProvider.zrange(
      `production:workflows:${userId}`,
      0,
      -1,
      'REV',
    );
    const items = await Promise.all(
      ids.map((threadId) =>
        this.redisProvider.get(this.workflowIndexKey(userId, threadId)),
      ),
    );
    const redisItems = items
      .filter((item): item is string => Boolean(item))
      .map((item) => JSON.parse(item) as Record<string, unknown>)
      .filter((item) => this.tenantMatches(item.tenantId, tenantId));
    const memoryItems = [...this.workflowIndexMemory.values()].filter(
      (item) =>
        item.userId === userId && this.tenantMatches(item.tenantId, tenantId),
    );
    const merged = new Map<string, Record<string, unknown>>();
    [...redisItems, ...memoryItems].forEach((item) => {
      const threadId = typeof item.threadId === 'string' ? item.threadId : '';
      if (threadId) merged.set(threadId, item);
    });
    const workflows = [...merged.values()].sort((a, b) =>
      String(b.updatedAt).localeCompare(String(a.updatedAt)),
    );
    await Promise.all(
      workflows.map((item) => this.ensureIndexedRun(item, userId)),
    );
    return workflows;
  }

  async codingContext(threadId: string, userId: string, tenantId?: string) {
    const state = await this.getOwnedState(threadId, userId, tenantId);
    if (state.status !== 'completed') {
      throw new Error(`workflow is not completed: ${state.status}`);
    }
    const stages = state.selectedRoles
      .map((role) => state.results[role])
      .filter((result): result is ProductionStageResult => Boolean(result));
    const notReady = stages.filter(
      (result) =>
        result.reviewStatus !== 'approved' || !result.readyForApproval,
    );
    if (stages.length !== state.selectedRoles.length || notReady.length > 0) {
      const roles = [
        ...state.selectedRoles.filter((role) => !state.results[role]),
        ...notReady.map((result) => result.role),
      ];
      throw new Error(
        `workflow handoff is not accepted for export: ${[...new Set(roles)].join(', ')}`,
      );
    }
    return {
      threadId: state.threadId,
      projectId: state.projectId,
      status: state.status,
      selectedRoles: state.selectedRoles,
      completedRoles: state.completedRoles,
      brief: state.brief,
      stages: stages.map((result) => ({
        role: result.role,
        revision: result.revision,
        reviewStatus: result.reviewStatus,
        summary: result.summary,
        riskLevel: result.riskLevel,
        evidenceCoverage: result.evidenceCoverage,
        claims: result.claims,
        issues: result.issues,
        downstreamRisks: result.downstreamRisks,
        deliverables: result.deliverables,
        evidence: result.evidence,
        generatedArtifact: result.generatedArtifact,
        lowCodeSchemas: result.lowCodeSchemas,
      })),
    };
  }

  /** 管理端任务重跑前的租户边界校验；不新增任务表 owner 列，直接复用工作流状态 owner。 */
  async assertOwnedThread(threadId: string, userId: string): Promise<void> {
    await this.getOwnedState(threadId, userId);
  }

  /** 页面目录导出、项目 ZIP 和 MCP 共同消费的唯一交接契约。 */
  async handoffManifest(threadId: string, userId: string, tenantId?: string) {
    const context = await this.codingContext(threadId, userId, tenantId);
    const schemas = context.stages.flatMap((stage) =>
      (stage.lowCodeSchemas ?? []).map((schema) => ({
        ...schema,
        role: stage.role,
      })),
    );
    const citations = context.stages.flatMap((stage) =>
      (stage.evidence ?? []).map((evidence) => ({
        role: stage.role,
        ...evidence,
      })),
    );
    const stages = context.stages.map((stage) => ({
      role: stage.role,
      revision: stage.revision,
      reviewStatus: stage.reviewStatus,
      evidenceCoverage: stage.evidenceCoverage,
      generatedArtifact: stage.generatedArtifact,
      deliverables: stage.deliverables.map((item) => ({
        type: item.type,
        title: item.title,
        sha256: this.handoffHash(item.markdown),
      })),
      schemaSha256: this.handoffHash(
        JSON.stringify(stage.lowCodeSchemas ?? []),
      ),
      evidenceSha256: this.handoffHash(JSON.stringify(stage.evidence ?? [])),
    }));
    const markdown = this.buildHandoffMarkdown(context);
    const contentHash = this.handoffHash(
      JSON.stringify({
        threadId: context.threadId,
        projectId: context.projectId,
        stages,
        markdown,
      }),
    );
    return {
      formatVersion: 1,
      artifactName: `${context.projectId}-handoff`,
      threadId: context.threadId,
      projectId: context.projectId,
      contentHash,
      context,
      manifest: {
        contentHash,
        selectedRoles: context.selectedRoles,
        completedRoles: context.completedRoles,
        stages,
      },
      markdown,
      schemas,
      citations,
    };
  }

  async playwayPreview(threadId: string, userId: string, tenantId?: string) {
    const context = await this.codingContext(threadId, userId, tenantId);
    const schemas = context.stages.flatMap(
      (stage) => stage.lowCodeSchemas ?? [],
    );
    return renderPlaywayPreview(schemas, context.projectId, context.brief);
  }

  async generateProject(threadId: string, userId: string, tenantId?: string) {
    const context = await this.codingContext(threadId, userId, tenantId);
    const run = await this.agentRuns?.findLatestByThread(threadId);
    const handoff = context.stages
      .map(
        (stage) =>
          `${stage.role}\n${stage.summary}\n\n结构化 Schema：\n${JSON.stringify(stage.lowCodeSchemas ?? []).slice(0, 12_000)}\n\n${stage.deliverables.map((item) => `## ${item.title}\n${item.markdown.slice(0, 12_000)}`).join('\n\n')}`,
      )
      .join('\n\n');
    const messages = [
      {
        role: 'system',
        content: productionProjectGenerationPromptDefinitions.system,
      },
      {
        role: 'user',
        content: `活动：${context.projectId}\n需求背景：${context.brief.slice(0, 8_000)}\n\n已审批岗位交付物和低代码 Schema：\n${handoff.slice(0, 80_000)}\n\n现在只输出 JSON。必须优先参考 pageSchema、apiSchema、trackingSchema、validationSchema 和 acceptanceSchema 生成代码；必须生成 package.json、index.html、src/main.tsx 或 src/main.jsx、主要页面和样式文件。`,
      },
    ];
    const generate = async (signal?: AbortSignal) => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const output = await this.llmProvider.runWithSignal(signal, () =>
            this.llmProvider
              .getModel()
              .withStructuredOutput(projectSchema, { method: 'jsonMode' })
              .invoke(messages, {
                metadata: {
                  ...getPromptMetadata('workflow.project_generation'),
                  ...(attempt > 1
                    ? {
                        repairPromptName: 'workflow.project_generation.repair',
                        repairPromptVersion: getPromptMetadata(
                          'workflow.project_generation.repair',
                        ).promptVersion,
                      }
                    : {}),
                },
              }),
          );
          const normalized = {
            ...output,
            notes: Array.isArray(output.notes)
              ? output.notes
              : [String(output.notes ?? '')].filter(Boolean),
          };
          return this.validateGeneratedProject({
            ...normalized,
            activityName: context.projectId,
            sourceThreadId: context.threadId,
          });
        } catch (error) {
          lastError = error;
          if (attempt === 1)
            messages.push({
              role: 'user',
              content: productionProjectGenerationPromptDefinitions.repair,
            });
        }
      }
      throw new Error(
        `项目代码结构化生成失败：${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    };
    const execution = this.toolExecution
      ? await this.toolExecution.execute({
          toolName: 'artifact_generate',
          threadId,
          runId: run?.id,
          ownerUserId: userId,
          mode: 'production',
          role: 'frontend',
          actor: 'code_delivery',
          input: {
            projectId: context.projectId,
            stageCount: context.stages.length,
            type: 'runnable_project',
          },
          approvalPolicy: 'auto',
          execute: (signal) => generate(signal),
        })
      : {
          status: 'success' as const,
          output: await executeWithToolTimeout(
            'artifact_generate',
            getRegisteredToolTimeoutMs('artifact_generate'),
            (signal) => generate(signal),
          ),
          durationMs: 0,
        };
    if (!execution.output)
      throw new Error(
        ('error' in execution ? execution.error : undefined) ??
          '项目代码生成未完成，请在运行中心查看工具执行记录。',
      );
    return execution.output;
  }

  async generateProjectZip(
    threadId: string,
    userId: string,
    tenantId?: string,
  ): Promise<Buffer> {
    const handoff = await this.handoffManifest(threadId, userId, tenantId);
    const context = handoff.context;
    const generated = await this.generateProject(threadId, userId, tenantId);
    const zip = new JSZip();
    generated.files.forEach((file) => zip.file(file.path, file.content));
    zip.file(
      'RAG_WORKFLOW_CONTEXT.json',
      JSON.stringify({ ...context, generatedProject: generated }, null, 2),
    );
    zip.file(
      'HANDOFF_MANIFEST.json',
      JSON.stringify(handoff.manifest, null, 2),
    );
    zip.file(
      'LOW_CODE_SCHEMAS.json',
      JSON.stringify(
        context.stages.flatMap((stage) => stage.lowCodeSchemas ?? []),
        null,
        2,
      ),
    );
    const evidence = context.stages.flatMap((stage) =>
      (stage.evidence ?? []).map((item) => ({ role: stage.role, ...item })),
    );
    zip.file('RAG_EVIDENCE.json', JSON.stringify(evidence, null, 2));
    zip.file('RAG_EVIDENCE.md', this.buildEvidenceMarkdown(evidence));
    zip.file('HANDOFF.md', handoff.markdown);
    zip.file(
      'README.md',
      `# ${generated.projectName}\n\n框架：${generated.framework}\n\n启动：\`${generated.runCommand}\`\n\n${generated.notes.map((note) => `- ${note}`).join('\n')}\n`,
    );
    zip.file(
      'DELIVERY_VERIFICATION.json',
      JSON.stringify(this.deliveryVerification(generated), null, 2),
    );
    context.stages.forEach((stage) => {
      if ((stage.lowCodeSchemas ?? []).length > 0) {
        zip.file(
          `schemas/${stage.role}.json`,
          JSON.stringify(stage.lowCodeSchemas, null, 2),
        );
      }
      stage.deliverables.forEach((deliverable, index) => {
        const safeTitle = deliverable.title.replace(/[\\/:*?"<>|]/g, '-');
        zip.file(
          `handoff/${stage.role}/${String(index + 1).padStart(2, '0')}-${safeTitle}.md`,
          deliverable.markdown,
        );
      });
    });
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  protected buildHandoffMarkdown(
    context: Awaited<ReturnType<ProductionWorkflowQueryBase['codingContext']>>,
  ): string {
    const stages = context.stages.map((stage) =>
      [
        `## ${stage.role}`,
        stage.summary,
        ...stage.deliverables.map(
          (item) => `### ${item.title}\n\n${item.markdown}`,
        ),
      ].join('\n\n'),
    );
    return [
      `# ${context.projectId} 产研运交接包`,
      '本文件供 Codex、Claude、Cursor 等 AI Coding 工具读取。结构化 Schema 见 `LOW_CODE_SCHEMAS.json` 或 `schemas/`，引用证据见 `RAG_EVIDENCE.md`。',
      ...stages,
    ].join('\n\n');
  }

  protected buildEvidenceMarkdown(
    evidence: Array<ProductionEvidence & { role: string }>,
  ): string {
    const lines = evidence.map(
      (item) =>
        `- [${item.role}] ${item.id}：文档 ${item.docId}／片段 ${item.chunkIndex}／评分 ${item.totalScore}\n  - ${item.excerpt}`,
    );
    return [
      '# RAG 引用证据',
      lines.length > 0
        ? lines.join('\n')
        : '本次工作流未检索到可引用的 RAG 证据。',
    ].join('\n\n');
  }

  protected handoffHash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
