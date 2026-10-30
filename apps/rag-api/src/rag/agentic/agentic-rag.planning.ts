import type {
  RetrieveOptions,
  PrefetchedFastPath,
} from '../contracts/rag-types';
import { SseCallback } from './sse-event';
import {
  type AgenticRagStateType,
  createAgenticArtifact,
} from './agentic-rag.state';
import { createFallbackQueryPlan } from '../planning/query-plan';
import { type BadCaseMatch } from '../prompts/bad-case-flywheel.service';
import { RunnableConfig } from '@langchain/core/runnables';
import {
  buildExplicitSubQuestions,
  buildSubQuestions,
  resolveAutoRoute,
} from './agentic-rag-planning';
import { AgenticRagBase } from './agentic-rag.base';

export class AgenticRagPlanning extends AgenticRagBase {
  /**
   * 路由决策：判断走 simple 还是 agentic
   * auto 模式下只在明确复杂问题时走 agentic
   */
  routeNode(
    state: AgenticRagStateType,
    mode: 'simple' | 'agentic' | 'auto',
    config?: RunnableConfig,
  ): Partial<AgenticRagStateType> {
    const retrieveOptions = (config?.configurable?.retrieveOptions ??
      {}) as RetrieveOptions;
    const queryPlan =
      retrieveOptions.queryPlan ?? createFallbackQueryPlan(state.query);
    let route: 'simple' | 'agentic';

    if (mode === 'auto') {
      route = resolveAutoRoute(queryPlan, state.retrievalSufficient);
    } else {
      route = mode;
    }

    this.logger.log(
      `Route decision: ${route} (mode=${mode}, query="${state.query.slice(0, 50)}")`,
    );
    return { route };
  }

  resolveAutoRoute(
    queryPlan: ReturnType<typeof createFallbackQueryPlan>,
    fastPathSufficient: boolean,
  ): 'simple' | 'agentic' {
    return resolveAutoRoute(queryPlan, fastPathSufficient);
  }

  buildSubQuestions(
    original: string,
    queries: string[],
    limit: number,
  ): ReturnType<typeof buildSubQuestions> {
    return buildSubQuestions(original, queries, limit);
  }

  buildExplicitSubQuestions(
    questions: string[],
    maxSubQuestions: number,
  ): ReturnType<typeof buildExplicitSubQuestions> {
    return buildExplicitSubQuestions(questions, maxSubQuestions);
  }

  /** 将 QueryPlan 整理成 Agentic 状态节点使用的查询与子问题清单。 */
  async prepareQueriesNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    const userId = config?.configurable?.userId as string | undefined;
    const retrieveOptions = (config?.configurable?.retrieveOptions ??
      {}) as RetrieveOptions;
    const prefetchedFastPath = config?.configurable?.prefetchedFastPath as
      | PrefetchedFastPath
      | undefined;
    const badCaseMatchesPromise = retrieveOptions.executionPlan?.scopeRestricted
      ? Promise.resolve([] as BadCaseMatch[])
      : prefetchedFastPath?.badCaseMatches
        ? Promise.resolve(prefetchedFastPath.badCaseMatches)
        : this.withTimeout(
            this.badCaseFlywheel.retrieveMatches(state.query, 2, userId),
            2_000,
            'Bad case candidate retrieval',
          ).catch(() => [] as BadCaseMatch[]);
    const queryPlan =
      retrieveOptions.queryPlan ?? createFallbackQueryPlan(state.query);
    const plannedQueries = retrieveOptions.executionPlan?.queries.map(
      (item) => item.text,
    ) ?? [state.query, ...queryPlan.subQueries];
    const queries = Array.from(
      new Set([state.query, ...plannedQueries, ...state.augmentedQueries]),
    )
      .filter(Boolean)
      .slice(0, this.maxRetrievalQueries);
    const plannedSubQuestions =
      state.subQuestions?.length > 0
        ? state.subQuestions
        : queryPlan.subQueries.length > 0
          ? buildExplicitSubQuestions(
              queryPlan.subQueries,
              this.maxSubQuestions,
            )
          : buildExplicitSubQuestions([state.query], this.maxSubQuestions);
    const subQuestions = plannedSubQuestions.slice(
      0,
      this.getSubQuestionLimit(config),
    );
    onEvent?.({
      type: 'query_augment',
      data: { queries, subQuestions },
    });
    const artifact = createAgenticArtifact(
      'subquestion_plan',
      'prepareQueries',
      {
        query: state.query,
        subQuestions,
      },
    );
    onEvent?.({ type: 'artifact', data: artifact });
    return {
      augmentedQueries: queries,
      subQuestions,
      badCaseMatches: await badCaseMatchesPromise,
      artifacts: [artifact],
    };
  }
}
