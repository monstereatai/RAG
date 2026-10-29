import { scopeForEffectiveTime } from '../retrieval/effective-time';
import { Injectable } from '@nestjs/common';
import type { RetrievalProfile } from '../evidence/retrieval.types';
import { retrievalProfileForTaskType } from '../retrieval/context-builder';
import type { RetrievalScope } from '../evidence/retrieval.types';
import type { QueryPlan, QuerySourcePolicy } from './query-plan';
import type {
  PlannedRetrievalQuery,
  RetrievalExecutionPlan,
} from '../contracts/retrieval-execution-plan';

export type {
  PlannedRetrievalQuery,
  RetrievalExecutionPlan,
} from '../contracts/retrieval-execution-plan';

export interface RetrievalPolicyOptions {
  /** 用户显式选择知识库或业务 Scope 时，禁止公共知识／联网策略绕过该范围。 */
  forceLocal?: boolean;
}

@Injectable()
export class RetrievalPolicyService {
  build(
    originalQuery: string,
    plan: QueryPlan,
    scope?: RetrievalScope,
    profileOverrides?: Partial<RetrievalProfile>,
    options: RetrievalPolicyOptions = {},
  ): RetrievalExecutionPlan {
    const original = originalQuery.trim();
    const contextual = plan.standaloneQuery.trim();
    const contextualMode = ['setting', 'follow_up', 'mixed'].includes(
      plan.contextMode,
    );
    const narrowedScope = scopeForEffectiveTime(original, this.narrowScope(scope));
    const scopeRestricted = Boolean(
      options.forceLocal ||
      narrowedScope?.effectiveTime ||
      scope?.projectId?.trim() ||
      scope?.activityId?.trim() ||
      scope?.region?.trim() ||
      scope?.locale?.trim() ||
      scope?.channel?.trim() ||
      scope?.documentType?.trim(),
    );
    const sourcePolicy: QuerySourcePolicy =
      scopeRestricted || plan.domain === 'internal' || contextualMode
        ? 'local_only'
        : plan.domain === 'realtime'
          ? 'web_allowed'
          : plan.action === 'direct'
            ? 'direct_answer'
            : 'local_only';
    const reasonCode: RetrievalExecutionPlan['reasonCode'] =
      sourcePolicy === 'local_only'
        ? plan.domain === 'public'
          ? 'public_retrieval'
          : 'internal_evidence_required'
        : sourcePolicy === 'web_allowed'
          ? 'realtime_web_allowed'
          : 'stable_public_direct';
    const queries: PlannedRetrievalQuery[] = [
      { text: original, kind: 'original', weight: 1 },
    ];
    if (
      ['follow_up', 'mixed'].includes(plan.contextMode) &&
      contextual &&
      contextual !== original
    ) {
      queries.push({ text: contextual, kind: 'standalone', weight: 0.85 });
    }
    for (const subQuery of plan.subQueries.slice(0, 3)) {
      const text = subQuery.trim();
      if (text && !queries.some((query) => query.text === text)) {
        queries.push({ text, kind: 'sub_query', weight: 0.7 });
      }
    }
    const detected = retrievalProfileForTaskType(plan.taskType);
    return {
      planVersion: 2,
      sourcePolicy,
      queries,
      profile: profileOverrides
        ? { ...detected, ...profileOverrides, intent: detected.intent }
        : detected,
      useGraph: plan.needsGraph,
      scope: narrowedScope,
      scopeRestricted,
      reasonCode,
    };
  }

  /**
   * 只有调用方显式传入的 scope 才能成为检索硬约束。
   * QueryPlan 中的 project/documentType 是模型从问题文本推断出的软信号，
   * 若直接作为 filter 会把“用户反馈处理规范”这类实体词误当成 projectId，
   * 导致已授权文档被错误过滤。
   */
  private narrowScope(
    scope: RetrievalScope | undefined,
  ): RetrievalScope | undefined {
    if (scope == null) return undefined;
    return { ...scope };
  }
}
