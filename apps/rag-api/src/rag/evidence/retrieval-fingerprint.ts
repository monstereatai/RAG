import { createHash } from 'node:crypto';
import type { RetrieveOptions } from '../contracts/rag-types';
import type { RetrievalExecutionPlan } from '../contracts/retrieval-execution-plan';

/** 请求内检索去重指纹；只保存哈希，不把查询或权限明文写入事件。 */
export function createRetrievalFingerprint(
  query: string,
  userId: string | undefined,
  options: RetrieveOptions,
  executionPlan?: RetrievalExecutionPlan,
): string {
  const requestContext = options.requestContext;
  const plan =
    executionPlan ?? options.executionPlan ?? requestContext?.executionPlan;
  const scope = plan?.scope ?? options.scope ?? requestContext?.scope;
  const identity = {
    query: normalize(query),
    userId: userId ?? requestContext?.userId ?? null,
    tenantId: options.tenantId ?? requestContext?.tenantId ?? null,
    roles: sorted(options.roles),
    departmentIds: sorted(options.departmentIds),
    trustedAdminPrincipal: options.trustedAdminPrincipal ?? false,
    scope: stableValue(scope ?? null),
    sourcePolicy:
      plan?.sourcePolicy ??
      options.sourcePolicy ??
      requestContext?.sourcePolicy ??
      'local_only',
    scopeRestricted:
      plan?.scopeRestricted ??
      requestContext?.executionPlan.scopeRestricted ??
      false,
    profile: stableValue(plan?.profile ?? options.profile ?? null),
    useGraph: plan?.useGraph ?? false,
    vectorSearch: options.vectorSearch ?? null,
    adaptiveVectorSearch: options.adaptiveVectorSearch ?? null,
    queryPlan: stableValue(
      options.queryPlan ?? requestContext?.queryPlan ?? null,
    ),
    knowledgeOnly: options.knowledgeOnly ?? false,
  };
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export function retrievalFingerprintsForPlan(
  query: string,
  userId: string | undefined,
  options: RetrieveOptions,
  executionPlan?: RetrievalExecutionPlan,
): string[] {
  const plan =
    executionPlan ??
    options.executionPlan ??
    options.requestContext?.executionPlan;
  const queries = new Set([
    query,
    ...(plan?.queries.map((item) => item.text) ?? []),
  ]);
  return Array.from(queries, (item) =>
    createRetrievalFingerprint(item, userId, options, plan),
  );
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function sorted(values?: string[]): string[] {
  return [...new Set(values ?? [])].sort();
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}
