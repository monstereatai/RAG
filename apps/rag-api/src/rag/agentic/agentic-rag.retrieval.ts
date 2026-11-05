import type {
  RetrieveOptions,
  PrefetchedFastPath,
} from '../contracts/rag-types';
import type { RetrievedChunk } from '../evidence/retrieval.types';
import { SseCallback } from './sse-event';
import {
  type AgenticRagStateType,
  type AgenticSubQuestion,
  createAgenticArtifact,
} from './agentic-rag.state';
import { RunnableConfig } from '@langchain/core/runnables';
import { buildSubQuestions } from './agentic-rag-planning';
import { AgenticRagPlanning } from './agentic-rag.planning';

export class AgenticRagRetrieval extends AgenticRagPlanning {
  /** Agentic 只负责多步推理；底层候选由统一计划检索一次性召回和融合。 */
  async retrievalNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    const userId = config?.configurable?.userId as string | undefined;
    const retrieveOptions = (config?.configurable?.retrieveOptions ??
      {}) as RetrieveOptions;
    const fastPathChunks = (
      (state.retryCount ?? 0) === 0
        ? (config?.configurable?.fastPathChunks ?? [])
        : []
    ) as RetrievedChunk[];
    const priorWebChunks = state.webSearchAttempted
      ? (state.retrievedChunks ?? []).filter((chunk) =>
          chunk.id.startsWith('web:'),
        )
      : [];
    const prefetchedFastPath = config?.configurable?.prefetchedFastPath as
      | PrefetchedFastPath
      | undefined;
    const subQuestionLimit = this.getSubQuestionLimit(config);
    const plannedSubQuestions =
      state.subQuestions?.length > 0
        ? state.subQuestions
        : buildSubQuestions(
            state.query,
            state.augmentedQueries,
            subQuestionLimit,
          );
    const boundedSubQuestions = plannedSubQuestions.slice(
      0,
      Math.min(subQuestionLimit, this.maxRetrievalQueries),
    );
    const executionPlan =
      retrieveOptions.executionPlan ??
      this.resolveExecutionPlan(state.query, retrieveOptions);
    const formalRetrieval = fastPathChunks.length
      ? Promise.resolve(fastPathChunks)
      : this.retrievalCapability
          .retrieve(
            state.query,
            {
              ...retrieveOptions,
              executionPlan,
              rankingQuery: state.query,
              skipRerank: true,
            },
            userId,
          )
          .catch((error: unknown) => {
            this.logger.warn(
              `Unified retrieval failed: ${(error as Error).message}`,
            );
            return [] as RetrievedChunk[];
          });
    const retrievedSubQuestionsPromise = formalRetrieval.then((chunks) =>
      boundedSubQuestions.map((subQuestion) => ({
        ...subQuestion,
        status:
          chunks.length > 0 ? ('retrieved' as const) : ('needs_more' as const),
        evidenceIds: [
          ...new Set([
            ...chunks.map((chunk) => chunk.id),
            ...subQuestion.evidenceIds.filter((id) => id.startsWith('web:')),
          ]),
        ],
        retrievalAttempts: subQuestion.retrievalAttempts + 1,
        results: chunks,
      })),
    );

    // 统一 Hybrid 结果、已审核纠错证据和 Obsidian 读取并发准备；Auto 预取结果不重查。
    this.logger.log(
      `Retrieving ${boundedSubQuestions.length}/${plannedSubQuestions.length} sub-questions with hybrid search for userId=${userId ?? 'none'}`,
    );

    const [retrievedSubQuestions, reviewedBaseCaseChunks, obsidianContext] =
      await Promise.all([
        retrievedSubQuestionsPromise,
        Promise.resolve(
          this.supportingEvidenceCapability.toReviewedEvidenceChunks(
            state.badCaseMatches?.length
              ? state.badCaseMatches
              : (prefetchedFastPath?.badCaseMatches ?? []),
          ),
        ),
        retrieveOptions.executionPlan?.scopeRestricted
          ? Promise.resolve({ hits: [], context: '' })
          : prefetchedFastPath?.obsidianHits
            ? Promise.resolve({
                hits: prefetchedFastPath.obsidianHits,
                context:
                  this.supportingEvidenceCapability.formatObsidianContext(
                    prefetchedFastPath.obsidianHits,
                  ),
              })
            : this.supportingEvidenceCapability
                .getObsidianContext(
                  state.query,
                  userId,
                  retrieveOptions.scope?.role,
                )
                .catch(() => ({ hits: [], context: '' })),
      ]);
    const sourceResolution =
      await this.supportingEvidenceCapability.resolveObsidianSourceEvidence(
        state.query,
        obsidianContext.hits,
        userId,
        retrieveOptions,
      );
    const obsidianEvidenceHits = obsidianContext.hits.filter(
      (hit) => !sourceResolution.sourceNotePaths.has(hit.path),
    );
    const obsidianChunks =
      this.supportingEvidenceCapability.toObsidianChunks(obsidianEvidenceHits);
    const allResults = retrievedSubQuestions.map((item) => item.results);
    const updatedSubQuestions: AgenticSubQuestion[] = retrievedSubQuestions.map(
      ({ results, ...subQuestion }) => {
        void results;
        return subQuestion;
      },
    );
    if (sourceResolution.chunks.length > 0 && updatedSubQuestions.length > 0) {
      const queryIndex = updatedSubQuestions.findIndex(
        (item) => item.question === state.query,
      );
      const primaryIndex = queryIndex >= 0 ? queryIndex : 0;
      const primaryQuestion = updatedSubQuestions[primaryIndex];
      const sourceIds = sourceResolution.chunks.map((chunk) => chunk.id);
      updatedSubQuestions[primaryIndex] = {
        ...primaryQuestion,
        evidenceIds: [
          ...new Set([...sourceIds, ...primaryQuestion.evidenceIds]),
        ],
        status: 'retrieved',
      };
    }

    const formalChunkMap = new Map<string, RetrievedChunk>();
    for (const chunk of [...allResults.flat(), ...sourceResolution.chunks]) {
      const existing = formalChunkMap.get(chunk.id);
      if (
        !existing ||
        this.rankEvidenceChunks([existing, chunk])[0] === chunk
      ) {
        formalChunkMap.set(chunk.id, chunk);
      }
    }
    const formalChunks = Array.from(formalChunkMap.values());
    const formalEvidenceSufficient =
      formalChunks.length > 0 &&
      this.assessRetrievedChunks(
        state.query,
        formalChunks,
        retrieveOptions.queryPlan?.taskType,
      ).sufficient;
    // 与 Simple/Auto 的统一证据策略保持一致：正式 RAG 已足够时，Obsidian
    // 只能作为可观测补充，不能挤占正式片段；正式 RAG 不足时才纳入长期笔记兜底。
    const baselineCandidates = [
      ...fastPathChunks,
      ...priorWebChunks,
      ...reviewedBaseCaseChunks,
      ...sourceResolution.chunks,
      ...(formalEvidenceSufficient ? [] : obsidianChunks),
    ];
    const baselineMap = new Map<string, RetrievedChunk>();
    for (const chunk of baselineCandidates) {
      const existing = baselineMap.get(chunk.id);
      if (
        !existing ||
        this.rankEvidenceChunks([existing, chunk])[0] === chunk
      ) {
        baselineMap.set(chunk.id, chunk);
      }
    }
    const baselineChunks = Array.from(baselineMap.values());
    const resultIds = new Set(
      [...allResults.flat(), ...baselineChunks].map((chunk) => chunk.id),
    );
    const remainingSubQuestions = plannedSubQuestions
      .slice(boundedSubQuestions.length)
      .map((item) => ({ ...item, status: 'needs_more' as const }));

    const fusedMap = new Map<string, RetrievedChunk>();
    for (const chunk of baselineChunks) {
      fusedMap.set(chunk.id, chunk);
    }
    for (const results of allResults) {
      for (const chunk of results) {
        const existing = fusedMap.get(chunk.id);
        if (
          !existing ||
          this.rankEvidenceChunks([existing, chunk])[0] === chunk
        ) {
          fusedMap.set(chunk.id, chunk);
        }
      }
    }

    const allFusedChunks = Array.from(fusedMap.values());
    const rankedChunks = this.rankEvidenceChunks(allFusedChunks);
    // 结构化事实答案会在后续引用门禁阶段优先使用确定性抽取。先把该答案
    // 实际引用的片段保留到 maxRetrievedChunks，避免多文档场景中无关高分片段
    // 把“薪资／OKR／版本”这类跨 chunk 事实挤掉。
    const deterministicAnswer = this.buildEvidenceFirstAnswer(
      state.query,
      allFusedChunks,
    );
    const deterministicChunks = deterministicAnswer
      ? [...deterministicAnswer.matchAll(/\[片段\s*(\d+)\]/g)]
          .map((match) => allFusedChunks[Number(match[1]) - 1])
          .filter((chunk): chunk is RetrievedChunk => Boolean(chunk))
      : [];
    const requiredIds = updatedSubQuestions
      .map((item) => item.evidenceIds[0])
      .filter((id): id is string => Boolean(id));
    const requiredChunks = requiredIds
      .map((id) => fusedMap.get(id))
      .filter((chunk): chunk is RetrievedChunk => Boolean(chunk));
    const chunks = Array.from(
      new Map(
        [...requiredChunks, ...deterministicChunks, ...rankedChunks].map(
          (chunk) => [chunk.id, chunk],
        ),
      ).values(),
    ).slice(0, this.maxRetrievedChunks);

    this.logger.log(
      `Retrieved ${chunks.length} unique chunks from ${boundedSubQuestions.length} sub-questions`,
    );

    onEvent?.({
      type: 'retrieval',
      data: {
        chunks,
        subQuestions: [...updatedSubQuestions, ...remainingSubQuestions].map(
          (item) => ({ ...item, evidenceCount: item.evidenceIds.length }),
        ),
        evidenceCount: resultIds.size,
      },
    });
    const previousArtifacts = (state.artifacts ?? []).filter(
      (artifact) => artifact.type !== 'evidence_bundle',
    );
    const evidenceArtifact = createAgenticArtifact(
      'evidence_bundle',
      'retrieval',
      {
        query: state.query,
        chunkIds: chunks.map((chunk) => chunk.id),
        subQuestions: [...updatedSubQuestions, ...remainingSubQuestions].map(
          ({ id, question, evidenceIds, status }) => ({
            id,
            question,
            evidenceIds,
            status,
          }),
        ),
        webSearchCount: state.webSearchCount,
      },
    );
    onEvent?.({ type: 'artifact', data: evidenceArtifact });
    if (chunks.length === 0) {
      this.metricsService.observeAgentEmptyRetrieval(state.route || 'agentic');
    }
    return {
      retrievedChunks: chunks,
      subQuestions: [...updatedSubQuestions, ...remainingSubQuestions],
      artifacts: [...previousArtifacts, evidenceArtifact],
      webSearchAttempted: state.webSearchAttempted,
      webSearchCount: state.webSearchCount,
      answer: '',
      passed: false,
    };
  }

  /**
   * 二次排序
   */
  async rerankNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType> & { reranked: boolean }> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    const prefetchedChunks = (
      (state.retryCount ?? 0) === 0
        ? (config?.configurable?.fastPathChunks ?? [])
        : []
    ) as RetrievedChunk[];
    // Auto 预取结果已经由检索层重排；本节点只负责未预取的 Agentic 候选。
    if (prefetchedChunks.length > 0) {
      onEvent?.({
        type: 'rerank',
        data: {
          enabled:
            this.rerankEnabled && this.dashScopeRerankService.isEnabled(),
          reranked: false,
          count: state.retrievedChunks.length,
        },
      });
      return { reranked: false };
    }
    if (state.retrievedChunks.length < 2) {
      onEvent?.({
        type: 'rerank',
        data: {
          enabled:
            this.rerankEnabled && this.dashScopeRerankService.isEnabled(),
          reranked: false,
          count: state.retrievedChunks.length,
        },
      });
      return { reranked: false };
    }

    if (
      !this.rerankEnabled ||
      !this.dashScopeRerankService.isEnabled() ||
      !this.toolPolicy.decide(
        'dashscope_rerank',
        this.pluginPolicy(config, 'agentic'),
      ).allowed
    ) {
      onEvent?.({
        type: 'rerank',
        data: {
          enabled: false,
          reranked: false,
          count: state.retrievedChunks.length,
        },
      });
      return { reranked: false };
    }

    try {
      const chunks = await this.executeAgenticTool(
        'dashscope_rerank',
        this.threadIdFromConfig(config),
        this.userIdFromConfig(config),
        {
          query: state.query,
          candidateCount: state.retrievedChunks.length,
          topN: this.maxRerankTopN,
        },
        (signal) =>
          this.dashScopeRerankService.rerank(
            state.query,
            state.retrievedChunks,
            this.maxRerankTopN,
            signal ??
              (config?.configurable?.abortSignal as AbortSignal | undefined),
          ),
        config,
      );
      const originalScoreById = new Map(
        state.retrievedChunks.map((chunk) => [chunk.id, chunk.totalScore]),
      );
      const rerankedChunks = chunks.map((chunk) => ({
        ...chunk,
        totalScore: originalScoreById.get(chunk.id) ?? chunk.totalScore,
        rerankScore: chunk.totalScore,
      }));
      onEvent?.({
        type: 'rerank',
        data: {
          enabled: true,
          reranked: true,
          count: chunks.length,
        },
      });
      return {
        retrievedChunks: this.rankEvidenceChunks(rerankedChunks),
        reranked: true,
      };
    } catch (err) {
      await this.rethrowIfAbortedOrCancelled(err, config);
      this.logger.warn(`DashScope rerank skipped: ${(err as Error).message}`);
      onEvent?.({
        type: 'rerank',
        data: {
          enabled: true,
          reranked: false,
          count: state.retrievedChunks.length,
        },
      });
      return { reranked: false };
    }
  }
}
