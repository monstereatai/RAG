import { SetMetadata } from '@nestjs/common';

export const API_SCOPES_KEY = 'api_scopes';

/**
 * Scopes also seed the tenant IAM permission catalog. Add new API scopes here
 * so JWT authorization and API-token authorization share one contract.
 */
export const API_SCOPE_CODES = [
  'rag:agent',
  'rag:chat',
  'rag:documents',
  'rag:evals',
  'rag:graph',
  'rag:jobs',
  'rag:mcp',
  'rag:memory',
  'rag:obsidian',
  'rag:observability',
  'rag:search',
  'rag:skills',
  'rag:speech',
  'rag:structured',
  'rag:summary',
  'rag:token:manage',
  'rag:workflow',
] as const;

/** Declare the IAM permission and API Token scope required by an endpoint. */
export const ApiScopes = (...scopes: string[]) => {
  const normalizedScopes = [...new Set(scopes.map((scope) => scope.trim()))];
  const unsupportedScopes = normalizedScopes.filter(
    (scope) =>
      !API_SCOPE_CODES.includes(scope as (typeof API_SCOPE_CODES)[number]),
  );
  if (unsupportedScopes.length > 0) {
    throw new Error(
      `Unregistered API scope(s): ${unsupportedScopes.join(', ')}`,
    );
  }
  return SetMetadata(API_SCOPES_KEY, normalizedScopes);
};
