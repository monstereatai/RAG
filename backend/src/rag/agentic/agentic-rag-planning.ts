import type { RetrieveOptions } from '../contracts/rag-types';
import type { QueryPlan } from '../planning/query-plan';
import type { AgenticRagStateType, AgenticSubQuestion } from './agentic-rag.state';

/** Auto 用已确认的 QueryPlan 和 Fast Path 证据决定是否升级。 */
export function resolveAutoRoute(
  queryPlan: QueryPlan,
  fastPathSufficient: boolean,
): 'simple' | 'agentic' {
  if (requiresAgenticPlan(queryPlan)) return 'agentic';
  if (!fastPathSufficient) return 'agentic';
  return 'simple';
}

export function requiresAgenticPlan(queryPlan: QueryPlan): boolean {
  return (
    queryPlan.subQueries.length > 0 ||
    ['comparison', 'synthesis'].includes(queryPlan.taskType) ||
    queryPlan.domain === 'realtime' ||
    queryPlan.action === 'execute'
  );
}

export function buildSubQuestions(
  original: string,
  queries: string[],
  limit: number,
): AgenticSubQuestion[] {
  const questions = Array.from(
    new Set([original, ...queries.map((query) => query.trim())]),
  ).filter(Boolean);
  return questions.slice(0, limit).map((question, index) => ({
    id: `subq-${index + 1}`,
    question,
    // 当前规划器生成互补问题；保留依赖字段，支持后续有向多跳计划。
    dependsOn: index === 0 ? [] : ['subq-1'],
    status: 'planned',
    evidenceIds: [],
    retrievalAttempts: 0,
    sufficient: false,
    reason: '',
  }));
}

export function buildExplicitSubQuestions(
  questions: string[],
  maxSubQuestions: number,
): AgenticSubQuestion[] {
  return questions.slice(0, maxSubQuestions).map((question, index) => ({
    id: `subq-${index + 1}`,
    question,
    dependsOn: [],
    status: 'planned',
    evidenceIds: [],
    retrievalAttempts: 0,
    sufficient: false,
    reason: '',
  }));
}

export function getSubQuestionCoverage(state: AgenticRagStateType): number {
  if (!state.subQuestions?.length) return 1;
  const covered = state.subQuestions.filter((item) => item.sufficient).length;
  return covered / state.subQuestions.length;
}

export function hasExplicitRetrievalScope(
  scope: RetrieveOptions['scope'],
): boolean {
  if (!scope) return false;
  if (scope.effectiveTime) return true;
  return [
    scope.projectId,
    scope.activityId,
    scope.region,
    scope.locale,
    scope.channel,
    scope.role,
    scope.documentType,
  ].some((value) => Boolean(value?.trim()));
}

/** Role preset 是默认执行上下文；其他非空 scope 字段代表显式收窄范围。 */
export function hasExplicitScopeFilter(
  scope: RetrieveOptions['scope'],
): boolean {
  if (!scope) return false;
  if (scope.effectiveTime) return true;
  return [
    scope.projectId,
    scope.activityId,
    scope.region,
    scope.locale,
    scope.channel,
    scope.documentType,
  ].some((value) => Boolean(value?.trim()));
}
