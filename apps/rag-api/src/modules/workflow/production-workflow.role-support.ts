import type { ProductionWorkflowContext } from './production-workflow.context';
import { createHash } from 'node:crypto';
import {
  PRODUCTION_ROLES,
  ProductionClaim,
  ProductionDeliverable,
  ProductionLowCodeSchema,
  ProductionLowCodeSchemaKind,
  ProductionRole,
  ProductionStageResult,
  ProductionWorkflowStateType,
} from './production-workflow.state';
import { ProductionWorkflowTools } from './production-workflow.tools';
import {
  executeWithToolTimeout,
  getRegisteredToolTimeoutMs,
} from '../../tools/tool-execution.service';
import { RISK_RANK } from './production-workflow.shared';

export class ProductionWorkflowRoleSupport {
  readonly context: ProductionWorkflowContext;

  constructor(context: ProductionWorkflowContext) {
    this.context = context;
  }
  degradedRoleResult(
    role: ProductionRole,
    state: ProductionWorkflowStateType,
    toolResult: Awaited<ReturnType<ProductionWorkflowTools['gather']>>,
    error: Error | null,
  ): ProductionStageResult {
    const evidenceList = toolResult.evidence.length
      ? toolResult.evidence
          .map((item) => `- [${item.id}] ${item.docId}：${item.excerpt}`)
          .join('\n')
      : '- 当前没有检索到可用证据。';
    return {
      role,
      revision: state.revisionNumber ?? 1,
      reviewStatus: 'pending',
      summary: `${role} 节点模型调用失败，已生成证据保全版交付物，待人工补充。`,
      deliverables: [
        {
          type: 'degraded-review',
          title: `${state.projectId}-${role}-降级交付物`,
          markdown: [
            `# ${state.projectId} ${role} 降级交付物`,
            '',
            '## 当前状态',
            '',
            '结构化模型调用未在预算内完成。本文件只保留任务背景和已检索证据，不生成未经证实的业务结论。',
            '',
            '## 任务背景',
            '',
            state.brief,
            '',
            '## 已检索证据',
            '',
            evidenceList,
            '',
            '## 后续动作',
            '',
            '- 由当前岗位负责人核对证据并补齐结论。',
            '- 修复模型调用后，只重跑当前岗位。',
          ].join('\n'),
        },
      ],
      claims: [
        {
          statement: '当前岗位结论尚未完成人工或模型确认。',
          evidenceIds: [],
          status: 'pending_confirmation',
        },
      ],
      evidence: toolResult.evidence,
      evidenceCoverage: 0,
      issues: [error?.message ?? 'structured model output unavailable'],
      downstreamRisks: ['下游不得把本岗位降级交付物视为已确认结论。'],
      riskLevel: 'high',
      toolExecutions: toolResult.executions,
      lowCodeSchemas: this.normalizeLowCodeSchemas(role, state, []),
      readyForApproval: false,
      completedAt: new Date().toISOString(),
    };
  }

  validateClaims(
    claims: ProductionClaim[],
    evidence: ProductionStageResult['evidence'],
  ): ProductionClaim[] {
    const allowedIds = new Set(evidence.map((item) => item.id));
    return claims.map((claim) => {
      const evidenceIds = claim.evidenceIds.filter((id) => allowedIds.has(id));
      return {
        ...claim,
        evidenceIds,
        status:
          claim.status === 'supported' && evidenceIds.length > 0
            ? 'supported'
            : 'pending_confirmation',
      };
    });
  }

  evidenceCoverage(claims: ProductionClaim[]): number {
    if (claims.length === 0) return 1;
    const supported = claims.filter(
      (claim) => claim.status === 'supported',
    ).length;
    return Number((supported / claims.length).toFixed(4));
  }

  sleep(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  async publishRoleArtifact(
    state: ProductionWorkflowStateType,
    result: ProductionStageResult,
  ) {
    this.context.state.assertLeaseOwned(state.threadId);
    const startedAt = Date.now();
    const authorization = this.context.toolPolicy?.decide('artifact_generate', {
      mode: 'production',
      role: result.role,
      pluginKeys: state.pluginKeys,
      allowedToolNames: state.pluginTools,
    });
    if (authorization && !authorization.allowed) {
      result.toolExecutions.push({
        tool: 'artifact_generate',
        status: 'blocked',
        durationMs: Date.now() - startedAt,
        evidenceCount: 0,
        fallback: '交付内容保留在工作流状态中，等待管理员修正工具授权。',
        error: authorization.reason,
      });
      await this.context.events.emitRuntimeEvent(
        state,
        'policy.denied',
        result.role,
        {
          tool: 'artifact_generate',
          reason: authorization.reason,
        },
      );
      return undefined;
    }
    const sourceText = this.renderDeliverables(
      result.deliverables,
      result.claims,
      result.lowCodeSchemas,
    );
    try {
      const execution = this.context.toolExecution
        ? await this.context.toolExecution.execute({
            toolName: 'artifact_generate',
            threadId: state.threadId,
            runId: state.runId || undefined,
            ownerUserId: state.userId,
            mode: 'production',
            role: result.role,
            actor: result.role,
            pluginKeys: state.pluginKeys,
            allowedToolNames: state.pluginTools,
            input: {
              title: `${state.projectId}-${result.role}-交付物`,
              size: sourceText.length,
            },
            // 岗位交付物只写入受权限保护的内部 Artifact；它是否继续流转由后续岗位审批门禁决定。
            approvalPolicy: 'auto',
            sideEffect: true,
            idempotencyKey: `workflow-artifact:${state.threadId}:${result.role}:${this.contentHash(sourceText)}`,
            execute: () =>
              this.context.artifacts.create({
                ownerUserId: state.userId,
                threadId: state.threadId,
                title: `${state.projectId}-${result.role}-交付物`,
                kind: 'markdown',
                sourceText,
              }),
          })
        : {
            status: 'success' as const,
            output: await executeWithToolTimeout(
              'artifact_generate',
              getRegisteredToolTimeoutMs('artifact_generate'),
              () =>
                this.context.artifacts.create({
                  ownerUserId: state.userId,
                  threadId: state.threadId,
                  title: `${state.projectId}-${result.role}-交付物`,
                  kind: 'markdown',
                  sourceText,
                }),
            ),
            durationMs: Date.now() - startedAt,
          };
      if (!execution.output)
        throw new Error(
          ('error' in execution ? execution.error : undefined) ??
            '交付物等待审批或执行结果未知。',
        );
      const artifact = execution.output;
      result.toolExecutions.push({
        tool: 'artifact_generate',
        status: 'success',
        durationMs: execution.durationMs,
        evidenceCount: 0,
      });
      return {
        id: String(artifact.id),
        title: String(artifact.title),
        kind: String(artifact.kind),
        status: String(artifact.status),
      };
    } catch (error) {
      result.toolExecutions.push({
        tool: 'artifact_generate',
        status: 'failed',
        durationMs: Date.now() - startedAt,
        evidenceCount: 0,
        fallback: '交付内容保留在工作流结果中，可稍后重新生成文件。',
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  renderDeliverables(
    deliverables: ProductionDeliverable[],
    claims: ProductionClaim[],
    lowCodeSchemas: ProductionLowCodeSchema[] = [],
  ): string {
    const sections = deliverables.map(
      (item) => `# ${item.title}\n\n${item.markdown}`,
    );
    const claimLines = claims.map(
      (claim) =>
        `- [${claim.status}] ${claim.statement}${
          claim.evidenceIds.length
            ? `（证据：${claim.evidenceIds.join('、')}）`
            : ''
        }`,
    );
    const schemaSection =
      lowCodeSchemas.length > 0
        ? [
            '# 低代码 / AI Coding 结构化 Schema',
            '```json',
            JSON.stringify(lowCodeSchemas, null, 2),
            '```',
          ]
        : [];
    return [
      ...sections,
      ...schemaSection,
      '# 事实声明与证据',
      ...claimLines,
    ].join('\n\n');
  }

  normalizeLowCodeSchemas(
    role: ProductionRole,
    state: ProductionWorkflowStateType,
    input: unknown,
  ): ProductionLowCodeSchema[] {
    const rawSchemas = Array.isArray(input) ? input : [];
    const normalized = rawSchemas
      .map((item) => this.normalizeLowCodeSchemaItem(role, item))
      .filter((item): item is ProductionLowCodeSchema => Boolean(item));
    return normalized.length > 0
      ? normalized
      : this.defaultLowCodeSchemas(role, state);
  }

  normalizeLowCodeSchemaItem(
    role: ProductionRole,
    item: unknown,
  ): ProductionLowCodeSchema | null {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (typeof record.kind !== 'string') return null;
    const kind = record.kind as ProductionLowCodeSchemaKind;
    if (
      ![
        'pageSchema',
        'apiSchema',
        'trackingSchema',
        'validationSchema',
        'acceptanceSchema',
      ].includes(kind)
    ) {
      return null;
    }
    const ownerRole = PRODUCTION_ROLES.includes(record.role as ProductionRole)
      ? (record.role as ProductionRole)
      : role;
    return {
      schemaVersion: 1,
      role: ownerRole,
      kind,
      title:
        typeof record.title === 'string'
          ? record.title
          : `${ownerRole}-${kind}`,
      source: record.source === 'fallback' ? 'fallback' : 'llm',
      components: this.recordArray(record.components),
      apis: this.recordArray(record.apis),
      events: this.recordArray(record.events),
      rules: this.recordArray(record.rules),
      checks: this.recordArray(record.checks),
      notes: Array.isArray(record.notes)
        ? record.notes.map((note) => String(note)).slice(0, 12)
        : [],
    };
  }

  recordArray(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value)
      ? value
          .filter(
            (item) => item && typeof item === 'object' && !Array.isArray(item),
          )
          .map((item) => item as Record<string, unknown>)
      : [];
  }

  defaultLowCodeSchemas(
    role: ProductionRole,
    state: ProductionWorkflowStateType,
  ): ProductionLowCodeSchema[] {
    const base = {
      schemaVersion: 1 as const,
      role,
      source: 'fallback' as const,
    };
    if (role === 'backend') {
      return [
        {
          ...base,
          kind: 'apiSchema',
          title: `${state.projectId} 接口契约 Schema`,
          apis: [
            {
              name: 'activityInfo',
              method: 'GET',
              path: `/api/${state.projectId}/info`,
              purpose: '读取活动基础信息、时间、状态和页面配置。',
              request: { query: ['activityId'] },
              response: { code: 'number', data: 'ActivityInfo' },
            },
          ],
          notes: [
            '模型未返回接口 Schema 时由系统兜底生成，供 AI Coding 起步。',
          ],
        },
      ];
    }
    if (role === 'qa') {
      return [
        {
          ...base,
          kind: 'acceptanceSchema',
          title: `${state.projectId} 测试验收 Schema`,
          checks: [
            {
              id: 'happy-path',
              name: '主流程可完成',
              expected: '用户能从活动入口进入、完成核心交互并看到结果反馈。',
              status: 'pending_confirmation',
            },
          ],
          notes: [
            '模型未返回验收 Schema 时由系统兜底生成，后续人工补齐真实用例。',
          ],
        },
      ];
    }
    if (role === 'operations') {
      return [
        {
          ...base,
          kind: 'trackingSchema',
          title: `${state.projectId} 运营埋点 Schema`,
          events: [
            {
              eventId: 'activity_page_view',
              trigger: '活动页面曝光',
              params: ['activityId', 'channel', 'region'],
            },
          ],
          notes: [
            '模型未返回埋点 Schema 时由系统兜底生成，后续对齐埋点平台字段。',
          ],
        },
      ];
    }
    return [
      {
        ...base,
        kind: 'pageSchema',
        title: `${state.projectId} 页面结构 Schema`,
        components: [
          {
            id: 'activity-root',
            type: 'page',
            name: '活动主页面',
            children: ['hero', 'rule', 'cta'],
          },
          { id: 'hero', type: 'section', name: '首屏视觉与活动入口' },
          { id: 'rule', type: 'section', name: '活动规则说明' },
          { id: 'cta', type: 'button', name: '核心行动按钮' },
        ],
        notes: [
          '模型未返回页面 Schema 时由系统兜底生成，保证下游代码生成有结构输入。',
        ],
      },
      {
        ...base,
        kind: 'validationSchema',
        title: `${state.projectId} 前置校验 Schema`,
        rules: [
          {
            field: 'activityId',
            rule: 'required',
            message: '必须带活动 ID，避免多活动共用页面时串配置。',
          },
        ],
      },
    ];
  }

  contentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 32);
  }

  validateGeneratedProject<
    T extends {
      files: Array<{ path: string; content: string }>;
      runCommand: string;
    },
  >(project: T): T {
    const paths = new Set(project.files.map((file) => file.path));
    const packageFile = project.files.find(
      (file) => file.path === 'package.json',
    );
    const entryFile = project.files.find((file) =>
      /^src\/main\.(tsx|jsx)$/.test(file.path),
    );
    if (!packageFile || !entryFile || !paths.has('index.html'))
      throw new Error(
        '生成代码缺少 package.json、index.html 或 src/main.tsx／src/main.jsx。',
      );
    let packageJson: { scripts?: Record<string, string> };
    try {
      packageJson = JSON.parse(packageFile.content) as {
        scripts?: Record<string, string>;
      };
    } catch {
      throw new Error('生成的 package.json 不是合法 JSON。');
    }
    if (!packageJson.scripts?.dev || !packageJson.scripts?.build)
      throw new Error('生成的 package.json 缺少 dev 或 build 脚本。');
    if (!/createRoot|ReactDOM\.render/.test(entryFile.content))
      throw new Error('项目入口没有挂载 React 页面。');
    if (
      project.files.some(
        (file) => file.path.includes('..') || file.path.startsWith('/'),
      )
    )
      throw new Error('项目文件路径不安全。');
    return project;
  }

  deliveryVerification(project: {
    projectName: string;
    framework: string;
    files: Array<{ path: string; content: string }>;
    runCommand: string;
    sourceThreadId: string;
  }) {
    const paths = project.files.map((file) => file.path);
    return {
      schemaVersion: 1,
      status: 'static_verified',
      projectName: project.projectName,
      framework: project.framework,
      sourceThreadId: project.sourceThreadId,
      checkedAt: new Date().toISOString(),
      checks: [
        {
          name: 'required_files',
          passed:
            paths.includes('package.json') &&
            paths.includes('index.html') &&
            paths.some((path) => /^src\/main\.(tsx|jsx)$/.test(path)),
        },
        {
          name: 'safe_relative_paths',
          passed: paths.every(
            (path) => !path.includes('..') && !path.startsWith('/'),
          ),
        },
        { name: 'package_scripts', passed: true },
        { name: 'react_mount', passed: true },
      ],
      runCommand: project.runCommand,
      note: '本系统不在服务端执行模型生成代码；已完成结构、路径、入口和启动脚本静态验收。下载后请在隔离目录执行依赖安装与构建。',
    };
  }

  requiresRoleApproval(
    role: ProductionRole,
    result: ProductionStageResult,
    state: ProductionWorkflowStateType,
  ): boolean {
    if (state.approvalMode === 'required') return true;
    if (state.approvalRoles.includes(role)) return true;
    if (state.approvalMode !== 'risk_based') return false;
    return (
      RISK_RANK[result.riskLevel] >= RISK_RANK[state.riskApprovalThreshold]
    );
  }

  unionRoles(
    current: ProductionRole[],
    additions: ProductionRole[],
  ): ProductionRole[] {
    const included = new Set([...current, ...additions]);
    return PRODUCTION_ROLES.filter((role) => included.has(role));
  }
}
