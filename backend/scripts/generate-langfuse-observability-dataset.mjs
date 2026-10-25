import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(
  __dirname,
  '..',
  'eval',
  'langfuse-observability.dataset.json',
);
const checkOnly = process.argv.includes('--check');

const baseConfig = {
  enabled: true,
  redactContent: true,
  inputCostUsdPer1k: 0.02,
  outputCostUsdPer1k: 0.06,
  nodeEnv: 'production',
};

const ref = (docId, chunkIndex = 0, totalScore = 0.92) => ({
  docId,
  chunkIndex,
  totalScore,
});

const event = (type, timestamp, data) => ({ type, timestamp, data });

const ragPayload = (marker, overrides = {}) => ({
  userId: 'langfuse-user-001',
  threadId: 'langfuse-session-001',
  query: `${marker} 请给出可引用的业务结论`,
  answer: `${marker} 已根据资料给出结论 [片段1]`,
  mode: 'simple',
  route: 'simple',
  model: 'qwen-plus',
  latencyMs: 842,
  citationCount: 1,
  refused: false,
  references: [ref('langfuse-doc-001')],
  inputTokensEstimated: 128,
  outputTokensEstimated: 32,
  costUsdEstimated: 0.0045,
  usageSource: 'estimated',
  events: [
    event('routing', '2026-10-18T00:00:00.000Z', { mode: 'simple' }),
    event('retrieval', '2026-10-18T00:00:00.100Z', { references: 1 }),
    event('citation', '2026-10-18T00:00:00.200Z', { citations: 1 }),
    event('final', '2026-10-18T00:00:00.300Z', { route: 'simple' }),
  ],
  ...overrides,
});

const scenarios = [
  {
    id: 'rag-simple-citation',
    category: 'rag_trace',
    description: 'Simple RAG answer with routing, retrieval, citation and final spans.',
    target: 'rag_answer',
    payload: ragPayload('LF_RAG_SIMPLE_MARKER'),
    expected: {
      traceNames: ['rag.answer'],
      generationNames: ['rag.generate'],
      spanNames: ['rag.routing', 'rag.retrieval', 'rag.citation', 'rag.final'],
      contains: ['LF_RAG_SIMPLE_MARKER', 'langfuse-user-001', 'langfuse-session-001'],
      absent: ['LF_RAG_SIMPLE_FORBIDDEN'],
    },
  },
  {
    id: 'rag-auto-multistep',
    category: 'rag_trace',
    description: 'Auto route upgraded to Agentic with query plan, sufficiency, rerank and reflection spans.',
    target: 'rag_answer',
    payload: ragPayload('LF_RAG_AUTO_MARKER', {
      mode: 'auto',
      route: 'agentic',
      latencyMs: 3210,
      citationCount: 2,
      references: [ref('langfuse-doc-001'), ref('langfuse-doc-002', 1, 0.88)],
      events: [
        event('routing', '2026-10-18T00:00:01.000Z', { route: 'agentic' }),
        event('query_augment', '2026-10-18T00:00:01.100Z', { queries: 2 }),
        event('retrieval', '2026-10-18T00:00:01.200Z', { candidates: 8 }),
        event('sufficiency', '2026-10-18T00:00:01.300Z', { sufficient: true }),
        event('rerank', '2026-10-18T00:00:01.400Z', { topN: 2 }),
        event('reflection', '2026-10-18T00:00:01.500Z', { passed: true }),
        event('final', '2026-10-18T00:00:01.600Z', { route: 'agentic' }),
      ],
    }),
    expected: {
      traceNames: ['rag.answer'],
      generationNames: ['rag.generate'],
      spanNames: [
        'rag.routing',
        'rag.query_plan',
        'rag.retrieval',
        'rag.sufficiency',
        'rag.rerank',
        'rag.reflection',
        'rag.final',
      ],
      contains: ['LF_RAG_AUTO_MARKER', 'agentic'],
    },
  },
  {
    id: 'rag-agentic-tool-and-web',
    category: 'tool_trace',
    description: 'Agentic path with local retrieval, web search fallback and tool call events.',
    target: 'rag_answer',
    payload: ragPayload('LF_RAG_TOOL_MARKER', {
      mode: 'agentic',
      route: 'agentic',
      citationCount: 1,
      references: [ref('langfuse-doc-web-001', 0, 0.72)],
      events: [
        event('routing', '2026-10-18T00:00:02.000Z', { route: 'agentic' }),
        event('retrieval', '2026-10-18T00:00:02.100Z', { candidates: 2 }),
        event('sufficiency', '2026-10-18T00:00:02.200Z', { sufficient: false }),
        event('web_search', '2026-10-18T00:00:02.300Z', { results: 3 }),
        event('tool_call', '2026-10-18T00:00:02.400Z', {
          tool: 'bocha_web_search',
          status: 'success',
        }),
        event('final', '2026-10-18T00:00:02.500Z', { route: 'agentic' }),
      ],
    }),
    expected: {
      traceNames: ['rag.answer'],
      generationNames: ['rag.generate'],
      spanNames: ['rag.web_search', 'rag.tool_call'],
      contains: ['LF_RAG_TOOL_MARKER', 'bocha_web_search'],
    },
  },
  {
    id: 'rag-refusal-no-evidence',
    category: 'refusal_trace',
    description: 'No-evidence refusal should record zero citations, refused metadata and no references.',
    target: 'rag_answer',
    payload: ragPayload('LF_RAG_REFUSAL_MARKER', {
      threadId: 'langfuse-session-refusal',
      query: 'LF_RAG_REFUSAL_MARKER 火星基地供应商编号是什么？',
      answer: '当前没有找到足以支撑确定结论的可靠资料。',
      citationCount: 0,
      refused: true,
      references: [],
      mode: 'simple',
      route: 'simple',
      events: [
        event('routing', '2026-10-18T00:00:03.000Z', { mode: 'simple' }),
        event('retrieval', '2026-10-18T00:00:03.100Z', { candidates: 0 }),
        event('final', '2026-10-18T00:00:03.200Z', { refused: true }),
      ],
    }),
    expected: {
      traceNames: ['rag.answer'],
      generationNames: ['rag.generate'],
      spanNames: ['rag.routing', 'rag.retrieval', 'rag.final'],
      contains: ['LF_RAG_REFUSAL_MARKER', 'refused'],
    },
  },
  {
    id: 'rag-version-conflict',
    category: 'citation_trace',
    description: 'Version conflict answer should keep citations and route metadata.',
    target: 'rag_answer',
    payload: ragPayload('LF_RAG_CONFLICT_MARKER', {
      mode: 'auto',
      route: 'agentic',
      citationCount: 2,
      references: [ref('langfuse-doc-old', 0, 0.7), ref('langfuse-doc-new', 0, 0.95)],
      answer: 'LF_RAG_CONFLICT_MARKER 2026 版优先，与 2025 版存在版本冲突 [片段1]',
      events: [
        event('routing', '2026-10-18T00:00:04.000Z', { route: 'agentic' }),
        event('retrieval', '2026-10-18T00:00:04.100Z', { candidates: 2 }),
        event('citation', '2026-10-18T00:00:04.200Z', { citations: 2 }),
        event('final', '2026-10-18T00:00:04.300Z', { route: 'agentic' }),
      ],
    }),
    expected: {
      traceNames: ['rag.answer'],
      generationNames: ['rag.generate'],
      spanNames: ['rag.retrieval', 'rag.citation', 'rag.final'],
      contains: ['LF_RAG_CONFLICT_MARKER', '2026', '冲突'],
    },
  },
  {
    id: 'rag-provider-reported-usage',
    category: 'usage_cost',
    description: 'Provider-reported token usage and explicit cost should be preserved in generation metadata.',
    target: 'rag_answer',
    payload: ragPayload('LF_RAG_USAGE_PROVIDER_MARKER', {
      inputTokensEstimated: 1000,
      outputTokensEstimated: 500,
      costUsdEstimated: 0.1234,
      usageSource: 'provider_reported',
    }),
    expected: {
      traceNames: ['rag.answer'],
      generationNames: ['rag.generate'],
      contains: ['LF_RAG_USAGE_PROVIDER_MARKER', 'usageDetails', 'costDetails'],
    },
  },
  {
    id: 'rag-estimated-token-cost',
    category: 'usage_cost',
    description: 'Estimated usage path should still emit token and cost details.',
    target: 'rag_answer',
    payload: ragPayload('LF_RAG_USAGE_ESTIMATED_MARKER', {
      inputTokensEstimated: undefined,
      outputTokensEstimated: undefined,
      costUsdEstimated: undefined,
      usageSource: 'estimated',
    }),
    expected: {
      traceNames: ['rag.answer'],
      generationNames: ['rag.generate'],
      contains: ['LF_RAG_USAGE_ESTIMATED_MARKER', 'usageDetails', 'costDetails'],
    },
  },
  {
    id: 'rag-long-event-compaction',
    category: 'data_quality',
    description: 'Long event payloads should be compacted and truncated at the observability boundary.',
    target: 'rag_answer',
    payload: ragPayload('LF_RAG_LONG_MARKER', {
      events: [
        event('tool_call', '2026-10-18T00:00:05.000Z', {
          tool: 'large_payload',
          status: 'success',
          preview: `LONG_EVENT_START_${'x'.repeat(800)}_LONG_EVENT_END`,
          items: Array.from({ length: 10 }, (_, index) => ({ index })),
        }),
        event('final', '2026-10-18T00:00:05.100Z', { ok: true }),
      ],
    }),
    expected: {
      traceNames: ['rag.answer'],
      generationNames: ['rag.generate'],
      spanNames: ['rag.tool_call'],
      contains: ['LF_RAG_LONG_MARKER', 'LONG_EVENT_START'],
      absent: ['LONG_EVENT_END'],
    },
  },
  {
    id: 'rag-redaction-enabled',
    category: 'redaction',
    description: 'Production redaction should remove email, phone, credential and long numeric identifiers.',
    target: 'rag_answer',
    payload: ragPayload('LF_RAG_REDACT_MARKER', {
      query:
        'LF_RAG_REDACT_MARKER 联系 alice@example.com 手机 13800138000，Token abcdef123456',
      answer:
        'LF_RAG_REDACT_MARKER 已按安全规则处理 6222021234567890123，联系 alice@example.com',
    }),
    expected: {
      traceNames: ['rag.answer'],
      generationNames: ['rag.generate'],
      contains: [
        'LF_RAG_REDACT_MARKER',
        '[email]',
        '[phone]',
        '[credential]',
        '[long-number]',
      ],
      absent: ['alice@example.com', '13800138000', 'abcdef123456', '6222021234567890123'],
    },
  },
  {
    id: 'rag-redaction-disabled-dev',
    category: 'redaction',
    description: 'Explicit non-production redaction override should preserve raw fixture content.',
    target: 'rag_answer',
    providerConfig: {
      redactContent: false,
      nodeEnv: 'development',
    },
    payload: ragPayload('LF_RAG_NO_REDACT_MARKER', {
      query: 'LF_RAG_NO_REDACT_MARKER 原始文本保留 dev@example.com',
      answer: 'LF_RAG_NO_REDACT_MARKER 原始文本保留 dev@example.com',
    }),
    expected: {
      traceNames: ['rag.answer'],
      generationNames: ['rag.generate'],
      contains: ['LF_RAG_NO_REDACT_MARKER', 'dev@example.com'],
    },
  },
  {
    id: 'rag-error-fallback',
    category: 'error_fallback',
    description: 'Fallback answer with error/retry events should still produce a traceable final state.',
    target: 'rag_answer',
    payload: ragPayload('LF_RAG_FALLBACK_MARKER', {
      mode: 'auto',
      route: 'agentic',
      refused: true,
      citationCount: 0,
      references: [],
      answer: 'LF_RAG_FALLBACK_MARKER 模型调用失败，已进入安全降级。',
      events: [
        event('routing', '2026-10-18T00:00:06.000Z', { route: 'agentic' }),
        event('retrieval', '2026-10-18T00:00:06.100Z', { candidates: 1 }),
        event('reflection', '2026-10-18T00:00:06.200Z', { error: 'timeout' }),
        event('final', '2026-10-18T00:00:06.300Z', { fallback: true }),
      ],
    }),
    expected: {
      traceNames: ['rag.answer'],
      generationNames: ['rag.generate'],
      spanNames: ['rag.retrieval', 'rag.reflection', 'rag.final'],
      contains: ['LF_RAG_FALLBACK_MARKER', 'timeout', 'fallback'],
    },
  },
  {
    id: 'production-workflow-success',
    category: 'production_agent',
    description: 'Production workflow trace with role stage span, tool execution events and generation.',
    target: 'production_workflow',
    payload: {
      userId: 'langfuse-user-workflow',
      threadId: 'langfuse-workflow-thread',
      projectId: 'LF_PROJECT_MARKER',
      brief: 'LF_WORKFLOW_MARKER 生成活动方案',
      status: 'completed',
      stepCount: 3,
      maxSteps: 18,
      approvalMode: 'auto',
      selectedRoles: ['product', 'design'],
      completedRoles: ['product', 'design'],
      pendingApprovalRoles: [],
      stages: [
        {
          role: 'product',
          summary: 'LF_STAGE_PRODUCT_MARKER 完成 PRD',
          riskLevel: 'medium',
          evidenceCoverage: 0.92,
          readyForApproval: true,
          claims: 8,
          supportedClaims: 7,
          issues: ['LF_STAGE_ISSUE_MARKER'],
          downstreamRisks: ['LF_DOWNSTREAM_MARKER'],
          toolExecutions: [
            {
              tool: 'bocha_web_search',
              status: 'success',
              durationMs: 420,
              evidenceCount: 4,
              fallback: 'none',
            },
          ],
          completedAt: '2026-10-18T00:00:07.000Z',
        },
      ],
    },
    expected: {
      traceNames: ['agent.production.workflow'],
      generationNames: ['agent.production.generation.product'],
      spanNames: ['agent.production.stage.product'],
      contains: [
        'LF_PROJECT_MARKER',
        'LF_WORKFLOW_MARKER',
        'LF_STAGE_PRODUCT_MARKER',
        'agent.production.tool.bocha_web_search',
        'agent.production.workflow.finished',
      ],
    },
  },
  {
    id: 'production-workflow-approval-pending',
    category: 'production_agent',
    description: 'Pending approval trace should retain approval roles and stage readiness.',
    target: 'production_workflow',
    payload: {
      userId: 'langfuse-user-workflow',
      threadId: 'langfuse-workflow-approval',
      projectId: 'LF_PROJECT_APPROVAL',
      brief: 'LF_WORKFLOW_APPROVAL_MARKER 方案等待审批',
      status: 'pending_approval',
      stepCount: 4,
      maxSteps: 18,
      approvalMode: 'required',
      selectedRoles: ['product', 'design'],
      completedRoles: ['product'],
      pendingApprovalRoles: ['design'],
      stages: [
        {
          role: 'design',
          summary: 'LF_STAGE_APPROVAL_MARKER 等待设计审批',
          riskLevel: 'high',
          evidenceCoverage: 0.78,
          readyForApproval: false,
          claims: 5,
          supportedClaims: 3,
          issues: ['需要补充用户访谈'],
          downstreamRisks: ['审批不通过会阻塞开发'],
          toolExecutions: [],
          completedAt: '2026-10-18T00:00:08.000Z',
        },
      ],
    },
    expected: {
      traceNames: ['agent.production.workflow'],
      generationNames: ['agent.production.generation.design'],
      spanNames: ['agent.production.stage.design'],
      contains: ['LF_WORKFLOW_APPROVAL_MARKER', 'pending_approval', 'pendingApprovalRoles'],
    },
  },
  {
    id: 'production-workflow-tool-error',
    category: 'production_agent',
    description: 'Tool failures and fallback reasons must be visible in the workflow trace.',
    target: 'production_workflow',
    payload: {
      userId: 'langfuse-user-workflow',
      threadId: 'langfuse-workflow-error',
      projectId: 'LF_PROJECT_ERROR',
      brief: 'LF_WORKFLOW_ERROR_MARKER 工具失败演练',
      status: 'failed',
      stepCount: 2,
      maxSteps: 18,
      approvalMode: 'risk_based',
      selectedRoles: ['product'],
      completedRoles: [],
      pendingApprovalRoles: [],
      stages: [
        {
          role: 'product',
          summary: 'LF_STAGE_ERROR_MARKER 工具失败',
          riskLevel: 'high',
          evidenceCoverage: 0.2,
          readyForApproval: false,
          claims: 3,
          supportedClaims: 1,
          issues: ['搜索服务不可用'],
          downstreamRisks: ['无法完成竞品分析'],
          toolExecutions: [
            {
              tool: 'bocha_web_search',
              status: 'failed',
              durationMs: 5000,
              evidenceCount: 0,
              fallback: 'bm25_only',
              error: 'network_timeout',
            },
          ],
          completedAt: '2026-10-18T00:00:09.000Z',
        },
      ],
    },
    expected: {
      traceNames: ['agent.production.workflow'],
      generationNames: ['agent.production.generation.product'],
      spanNames: ['agent.production.stage.product'],
      contains: ['LF_WORKFLOW_ERROR_MARKER', 'network_timeout', 'bm25_only', 'failed'],
    },
  },
  {
    id: 'scheduled-analysis-success',
    category: 'scheduled_analysis',
    description: 'Scheduled analysis trace with data scopes, snapshot counts and report generation.',
    target: 'scheduled_analysis',
    payload: {
      jobId: 'langfuse-job-001',
      userId: 'langfuse-user-analysis',
      name: 'LF_SCHEDULED_MARKER 每周运营分析',
      instruction: '分析本周活动表现并给出风险建议',
      window: 'last_7_days',
      dataScopes: ['documents', 'query_logs', 'feedback'],
      snapshotCounts: { documents: 23, queryLogs: 120, feedback: 8 },
      report: 'LF_SCHEDULED_REPORT_MARKER 本周转化率上升 6%，需要关注退款率。',
    },
    expected: {
      traceNames: ['agent.scheduled.analysis'],
      generationNames: ['agent.scheduled.analysis.report'],
      contains: [
        'LF_SCHEDULED_MARKER',
        'LF_SCHEDULED_REPORT_MARKER',
        'last_7_days',
        'snapshotCounts',
      ],
    },
  },
  {
    id: 'scheduled-analysis-redaction',
    category: 'redaction',
    description: 'Scheduled analysis report should be redacted before leaving the observability boundary.',
    target: 'scheduled_analysis',
    payload: {
      jobId: 'langfuse-job-redaction',
      userId: 'langfuse-user-analysis',
      name: 'LF_SCHEDULED_REDACT_MARKER',
      instruction: '联系 bob@example.com 手机 13900139000 处理异常',
      window: 'last_30_days',
      dataScopes: ['query_logs'],
      snapshotCounts: { queryLogs: 9 },
      report: 'LF_SCHEDULED_REPORT_REDACT 联系 bob@example.com 手机 13900139000',
    },
    expected: {
      traceNames: ['agent.scheduled.analysis'],
      generationNames: ['agent.scheduled.analysis.report'],
      contains: ['LF_SCHEDULED_REDACT_MARKER', '[email]', '[phone]'],
      absent: ['bob@example.com', '13900139000'],
    },
  },
  {
    id: 'smoke-enabled-contract',
    category: 'contract',
    description: 'Enabled Langfuse credentials should emit smoke trace/generation and report sent=true.',
    target: 'smoke',
    expected: {
      traceNames: ['rag.observability.smoke'],
      generationNames: ['rag.observability.smoke.generation'],
      contains: ['local observability smoke'],
      result: { smokeEnabled: true, smokeSent: true, healthEnabled: true },
    },
  },
  {
    id: 'disabled-missing-keys',
    category: 'contract',
    description: 'Missing keys must fail closed without emitting a batch.',
    target: 'disabled',
    providerConfig: { enabled: true, publicKey: '', secretKey: '' },
    expected: {
      batch: false,
      result: {
        statusEnabled: false,
        smokeEnabled: false,
        smokeSent: false,
        healthEnabled: false,
        smokeReason: 'langfuse_disabled_or_missing_keys',
      },
    },
  },
  {
    id: 'disabled-explicit',
    category: 'contract',
    description: 'Explicit disabled configuration must return a stable disabled health contract.',
    target: 'disabled',
    providerConfig: { enabled: false },
    expected: {
      batch: false,
      result: {
        statusEnabled: false,
        smokeEnabled: false,
        smokeSent: false,
        healthEnabled: false,
        smokeReason: 'langfuse_disabled_or_missing_keys',
      },
    },
  },
];

const dataset = {
  version: 'langfuse-observability-2026-10-18',
  schema: 'rag.langfuse.observability.dataset.v1',
  synthetic: true,
  description:
    'Replayable observability dataset for Langfuse trace, generation, span, usage, redaction, workflow, scheduled analysis and disabled-contract regression.',
  directions: [
    'trace_lifecycle',
    'rag_modes',
    'retrieval_and_citation_events',
    'tool_and_web_search_events',
    'refusal_and_version_conflict',
    'token_usage_and_cost',
    'content_redaction',
    'error_and_fallback_path',
    'production_workflow_spans',
    'scheduled_analysis',
    'session_and_user_grouping',
    'data_compaction',
    'enabled_smoke_contract',
    'disabled_contract',
  ],
  defaults: {
    baseConfig,
  },
  scenarios,
};

const serialized = `${JSON.stringify(dataset, null, 2)}\n`;

if (checkOnly) {
  const existing = await readFile(outputPath, 'utf8');
  if (existing !== serialized) {
    console.error('langfuse observability dataset is out of date');
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify({
        ok: true,
        dataset: outputPath,
        scenarios: scenarios.length,
        directions: dataset.directions.length,
      }),
    );
  }
} else {
  await writeFile(outputPath, serialized);
  console.log(
    JSON.stringify(
      {
        ok: true,
        dataset: outputPath,
        scenarios: scenarios.length,
        directions: dataset.directions.length,
      },
      null,
      2,
    ),
  );
}
