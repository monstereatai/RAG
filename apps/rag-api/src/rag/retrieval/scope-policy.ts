import type { RetrievalScope } from '../evidence/retrieval.types';
import type { RetrieveOptions } from '../contracts/rag-types';

export function hasExplicitDocumentScope(scope?: RetrievalScope): boolean {
  return Boolean(
    scope?.projectId?.trim() ||
    scope?.activityId?.trim() ||
    scope?.region?.trim() ||
    scope?.locale?.trim() ||
    scope?.channel?.trim() ||
    scope?.documentType?.trim() ||
    scope?.effectiveTime,
  );
}

export function isSupplementalEvidenceRestricted(
  options: RetrieveOptions,
): boolean {
  if (
    options.executionPlan?.scopeRestricted === true ||
    Boolean(options.tenantId?.trim()) ||
    Boolean(options.requestContext?.tenantId?.trim())
  ) {
    return true;
  }
  if (options.requestContext) return false;
  return Boolean(
    options.scope?.projectId?.trim() ||
    options.scope?.activityId?.trim() ||
    options.scope?.region?.trim() ||
    options.scope?.locale?.trim() ||
    options.scope?.channel?.trim() ||
    options.scope?.role?.trim() ||
    options.scope?.documentType?.trim() ||
    options.scope?.effectiveTime,
  );
}
