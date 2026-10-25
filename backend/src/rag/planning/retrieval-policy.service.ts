import { Injectable } from '@nestjs/common';
import type { RetrievalProfile } from '../karpathy/context-builder';
import { retrievalProfileForTaskType } from '../karpathy/context-builder';
import type { RetrievalScope } from '../karpathy/karpathy-rag.service';
import type { QueryPlan, QuerySourcePolicy } from './query-plan';

export interface PlannedRetrievalQuery {
  text: string;
  kind: 'original' | 'standalone' | 'sub_query';
  weight: number;
}

export interface RetrievalExecutionPlan {
  planVersion: 2;
  sourcePolicy: QuerySourcePolicy;
  queries: PlannedRetrievalQuery[];
  profile: RetrievalProfile;
  useGraph: boolean;
  scope?: RetrievalScope;
  /** 是否由用户显式知识库／Scope 或计划过滤器限定了本地检索范围。 */
  scopeRestricted?: boolean;
  reasonCode:
    | 'internal_evidence_required'
    | 'realtime_web_allowed'
    | 'stable_public_direct'
    | 'public_retrieval';
}

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
    const narrowedScope = this.narrowScope(scope);
    const scopeRestricted = Boolean(
      options.forceLocal ||
      scope?.projectId?.trim() ||
      scope?.activityId?.trim() ||
      scope?.region?.trim() ||
      scope?.locale?.trim() ||
      scope?.channel?.trim() ||
      scope?.documentType?.trim()
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
  private narrowScope(scope: RetrievalScope | undefined): RetrievalScope | undefined {
    if (scope == null) return undefined;
    return { ...scope };
  }
}
