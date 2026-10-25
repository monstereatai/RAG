import { z } from 'zod';

export const queryPlanSchema = z.object({
  action: z.enum(['direct', 'retrieve', 'execute']).default('retrieve'),
  domain: z.enum(['internal', 'public', 'realtime']).default('internal'),
  contextMode: z
    .enum(['independent', 'follow_up', 'setting', 'verification', 'mixed'])
    .default('independent'),
  standaloneQuery: z.string().trim().max(1000).default(''),
  subQueries: z.array(z.string().trim().min(1).max(1000)).max(5).default([]),
  taskType: z
    .enum(['lookup', 'procedure', 'comparison', 'synthesis'])
    .default('lookup'),
  needsGraph: z.boolean().default(false),
  entities: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
  filters: z
    .object({
      department: z.string().trim().max(100).optional(),
      project: z.string().trim().max(100).optional(),
      timeRange: z.string().trim().max(100).optional(),
      documentType: z.string().trim().max(100).optional(),
    })
    .default({}),
  clarificationQuestion: z.string().trim().max(300).optional(),
});

export type QueryPlan = z.infer<typeof queryPlanSchema>;
export type QueryTaskType = QueryPlan['taskType'];
export type EvidenceDomain = QueryPlan['domain'];
export type QueryContextMode = QueryPlan['contextMode'];
export type QuerySourcePolicy = 'direct_answer' | 'local_only' | 'web_allowed';

export const QUERY_PLAN_VERSION = 2;

export function createFallbackQueryPlan(query: string): QueryPlan {
  return {
    action: 'retrieve',
    domain: 'internal',
    contextMode: 'independent',
    standaloneQuery: query.trim(),
    subQueries: [],
    taskType: 'lookup',
    needsGraph: false,
    entities: [],
    filters: {},
  };
}

export function normalizeQueryPlan(query: string, value: unknown): QueryPlan {
  const plan = queryPlanSchema.parse(value);
  const original = query.trim();
  return {
    ...plan,
    standaloneQuery: plan.standaloneQuery.trim() || original,
    subQueries: [...new Set(plan.subQueries.map((item) => item.trim()))]
      .filter((item) => item && item !== original)
      .slice(0, 3),
    entities: [...new Set(plan.entities.map((item) => item.trim()))]
      .filter(Boolean)
      .slice(0, 10),
  };
}

/** 读取运行记录和 LangGraph checkpoint 中的旧 QueryIntent，不执行数据迁移。 */
export function adaptStoredQueryPlan(
  value: unknown,
  originalQuery = '',
  storedPlanVersion?: unknown,
): QueryPlan {
  const legacy = asRecord(value);
  if (!legacy) return createFallbackQueryPlan(originalQuery);
  const planVersion =
    typeof storedPlanVersion === 'number'
      ? storedPlanVersion
      : typeof legacy.planVersion === 'number'
        ? legacy.planVersion
        : undefined;
  // Zod object 会丢弃未知字段并为新字段补默认值。若先按新 schema 解析，
  // 旧 QueryIntent（尤其 contextMode=mixed）会“解析成功”，但 needsSynthesis、
  // requiresGraph 等旧语义会被静默丢失。因此先按版本／旧字段判型。
  const legacyKeys = [
    'intent',
    'queryType',
    'historyPolicy',
    'multiIntent',
    'sourcePolicy',
    'needsSynthesis',
    'requiresGraph',
    'targetKbs',
    'rewriteQueries',
    'ambiguity',
  ];
  const legacyContext = stringValue(legacy.contextMode);
  const isLegacy =
    planVersion !== QUERY_PLAN_VERSION &&
    (legacyKeys.some((key) => key in legacy) ||
      [
        'none',
        'conversation_setting',
        'context_follow_up',
        'factual_verification',
      ].includes(legacyContext ?? ''));

  if (!isLegacy) {
    const parsed = queryPlanSchema.safeParse(value);
    if (parsed.success) return normalizeQueryPlan(originalQuery, parsed.data);
  }

  const legacyIntent = stringValue(legacy.intent);
  const legacyQueryType = stringValue(legacy.queryType);
  const ambiguity = asRecord(legacy.ambiguity);
  const filters = asRecord(legacy.filters);
  const action =
    legacyIntent === 'task_execution' || legacyQueryType === 'task_execution'
      ? 'execute'
      : legacy.action === 'direct_answer'
        ? 'direct'
        : 'retrieve';
  const domain =
    legacyIntent === 'realtime' || legacyQueryType === 'realtime'
      ? 'realtime'
      : legacyIntent === 'objective_fact' ||
          legacyIntent === 'system_capability' ||
          legacyQueryType === 'public_knowledge'
        ? 'public'
        : 'internal';
  const contextMode: QueryContextMode =
    legacyContext === 'conversation_setting'
      ? 'setting'
      : legacyContext === 'context_follow_up'
        ? 'follow_up'
        : legacyContext === 'factual_verification'
          ? 'verification'
          : legacyContext === 'mixed'
            ? 'mixed'
            : 'independent';
  return normalizeQueryPlan(originalQuery, {
    action,
    domain,
    contextMode,
    standaloneQuery:
      stringValue(legacy.standaloneQuery) || originalQuery.trim(),
    subQueries: stringArray(legacy.subQueries).slice(0, 3),
    taskType:
      legacy.needsSynthesis === true
        ? 'synthesis'
        : legacyQueryType === 'multi_intent'
          ? 'comparison'
          : 'lookup',
    needsGraph: legacy.requiresGraph === true,
    entities: stringArray(legacy.entities),
    filters: {
      department: optionalString(filters?.department),
      project: optionalString(filters?.project),
      timeRange: optionalString(filters?.timeRange),
      documentType: optionalString(filters?.documentType),
    },
    clarificationQuestion:
      ambiguity?.detected === true
        ? optionalString(ambiguity.clarificationQuestion)
        : undefined,
  });
}

export function resolveStandaloneRetrievalQuery(
  query: string,
  plan?: QueryPlan,
): string {
  const original = query.trim();
  if (
    !plan ||
    !['follow_up', 'mixed'].includes(plan.contextMode) ||
    !plan.standaloneQuery.trim()
  ) {
    return original;
  }
  return plan.standaloneQuery.trim();
}

export function isObjectiveKnowledgePlan(plan?: QueryPlan): boolean {
  return Boolean(
    plan &&
    plan.domain === 'public' &&
    ['independent', 'verification'].includes(plan.contextMode),
  );
}

export function shouldClarifyQueryPlan(plan?: QueryPlan): boolean {
  return Boolean(plan?.clarificationQuestion?.trim());
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
