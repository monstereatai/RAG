import type {
  RetrieveOptions,
  PrefetchedFastPath,
} from '../contracts/rag-types';
import type { RetrievedChunk } from '../evidence/retrieval.types';
import type { RetrievalExecutionPlan } from '../contracts/retrieval-execution-plan';
import {
  createRetrievalFingerprint,
  retrievalFingerprintsForPlan,
} from '../evidence/retrieval-fingerprint';
import { isSupplementalEvidenceRestricted } from '../retrieval/scope-policy';
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
  /** 复用已执行检索，并只为尚未尝试的缺口执行一次定向查询。 */
  async retrievalNode(
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
    const prefetchedBundle = prefetchedFastPath?.evidenceBundle;
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
    const requestedFingerprints = new Set(
      retrievalFingerprintsForPlan(
        state.query,
        userId,
        retrieveOptions,
        retrieveOptions.executionPlan,
      ),
    );
    const prefetchedFingerprints =
      prefetchedFastPath?.retrievalFingerprints ??
      prefetchedBundle?.retrievalFingerprints ??
      [];
    const validFastPathReuse = Boolean(
      (prefetchedFastPath?.retrievalAttempted ??
        prefetchedBundle?.retrievalAttempted) &&
      prefetchedFingerprints.some((fingerprint) =>
        requestedFingerprints.has(fingerprint),
      ),
    );
    const priorFingerprints = new Set([
      ...(state.retrievalFingerprints ?? []),
      ...(validFastPathReuse ? prefetchedFingerprints : []),
    ]);
    const attemptedQuestions = boundedSubQuestions.filter((item) =>
      priorFingerprints.has(
        createRetrievalFingerprint(
          item.question,
          userId,
          retrieveOptions,
          retrieveOptions.executionPlan,
        ),
      ),
    );
    const newQuestions = boundedSubQuestions.filter(
      (item) =>
        !item.sufficient &&
        !priorFingerprints.has(
          createRetrievalFingerprint(
            item.question,
            userId,
            retrieveOptions,
            retrieveOptions.executionPlan,
          ),
        ),
    );
    const reusableFastPath = validFastPathReuse
      ? prefetchedFastPath
      : undefined;
    const toPlannedQuery = (question: string) => {
      const planned = executionPlan.queries.find(
        (query) => query.text === question,
      );
      return (
        planned ?? {
          text: question,
          kind: 'sub_query' as const,
          weight: 1,
        }
      );
    };
    const isInitialRetrieval =
      (state.retryCount ?? 0) === 0 && priorFingerprints.size === 0;
    const targetQueries = isInitialRetrieval
      ? Array.from(
          new Map(
            [
              ...executionPlan.queries,
              ...boundedSubQuestions.map((item) =>
                toPlannedQuery(item.question),
              ),
            ].map((item) => [item.text, item]),
          ).values(),
        )
      : newQuestions.map((item) => toPlannedQuery(item.question));
    const targetExecutionPlan: RetrievalExecutionPlan = {
      ...executionPlan,
      queries: targetQueries,
    };
    let newChunks: RetrievedChunk[] = [];
    let retrievalFailure = false;
    let latestRetrievalStatus: AgenticRagStateType['retrievalStatus'] =
      validFastPathReuse
        ? prefetchedBundle?.assessment.status === 'source_error'
          ? 'source_error'
          : (prefetchedBundle?.chunks.length ?? 0) > 0 ||
              (prefetchedFastPath?.retrieval.chunks.length ?? 0) > 0 ||
              ((
                config?.configurable?.fastPathChunks as
                  | RetrievedChunk[]
                  | undefined
              )?.length ?? 0) > 0
            ? 'hit'
            : 'no_result'
        : 'not_executed';
    const executedFingerprints = validFastPathReuse
      ? [...prefetchedFingerprints]
      : [];
    if (targetQueries.length > 0) {
      executedFingerprints.push(
        ...targetQueries.map((item) =>
          createRetrievalFingerprint(
            item.text,
            userId,
            retrieveOptions,
            retrieveOptions.executionPlan,
          ),
        ),
      );
      try {
        newChunks = await this.retrievalCapability.retrieve(
          state.query,
          {
            ...retrieveOptions,
            executionPlan: targetExecutionPlan,
            rankingQuery: state.query,
            skipRerank: true,
          },
          userId,
        );
        latestRetrievalStatus = newChunks.length > 0 ? 'hit' : 'no_result';
      } catch {
        retrievalFailure = true;
        latestRetrievalStatus = 'source_error';
        this.logger.warn(
          'Unified retrieval failed; evidence source status is source_error',
        );
      }
    }
    const duplicateRetrievalSkipped =
      targetQueries.length === 0 &&
      priorFingerprints.size > 0 &&
      boundedSubQuestions.some((item) => !item.sufficient);
    const allFingerprints = Array.from(
      new Set([...priorFingerprints, ...executedFingerprints]),
    );

    // 统一 Hybrid 候选、已审核纠正证据和 Obsidian 读取并发准备。
    this.logger.log(
      `Retrieving ${targetQueries.length}/${boundedSubQuestions.length} uncovered sub-questions with hybrid search`,
    );

    const reviewedBaseCaseChunks =
      this.supportingEvidenceCapability.toReviewedEvidenceChunks(
        state.badCaseMatches?.length
          ? state.badCaseMatches
          : (reusableFastPath?.badCaseMatches ?? []),
      );
    const obsidianContext = isSupplementalEvidenceRestricted(retrieveOptions)
      ? { hits: [], context: '' }
      : reusableFastPath?.obsidianHits
        ? {
            hits: reusableFastPath.obsidianHits,
            context: this.supportingEvidenceCapability.formatObsidianContext(
              reusableFastPath.obsidianHits,
            ),
          }
        : await this.supportingEvidenceCapability
            .getObsidianContext(
              state.query,
              userId,
              retrieveOptions.scope?.role,
            )
            .catch(() => ({ hits: [], context: '' }));
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
    const fastPathChunks = validFastPathReuse
      ? ((config?.configurable?.fastPathChunks ??
          reusableFastPath?.evidenceBundle?.chunks ??
          []) as RetrievedChunk[])
      : [];
    const priorChunks = state.retrievedChunks ?? [];
    const formalCandidates = this.uniqueChunks([
      ...priorChunks.filter((chunk) => chunk.retrievalSource !== 'obsidian'),
      ...fastPathChunks.filter((chunk) => chunk.retrievalSource !== 'obsidian'),
      ...newChunks,
      ...reviewedBaseCaseChunks,
      ...sourceResolution.chunks,
    ]);
    const requiredAspects = retrieveOptions.queryPlan?.subQueries.length
      ? retrieveOptions.queryPlan.subQueries
      : boundedSubQuestions.map((item) => item.question);
    const formalAssessment = this.assessRetrievedChunks(
      state.query,
      formalCandidates,
      retrieveOptions.queryPlan?.taskType,
      requiredAspects,
    );
    const baselineCandidates = this.uniqueChunks([
      ...priorChunks,
      ...fastPathChunks.filter(
        (chunk) =>
          formalAssessment.sufficient || chunk.retrievalSource !== 'obsidian',
      ),
      ...newChunks,
      ...reviewedBaseCaseChunks,
      ...sourceResolution.chunks,
      ...(formalAssessment.sufficient ? [] : obsidianChunks),
    ]);
    const baselineMap = new Map(
      baselineCandidates.map((chunk) => [chunk.id, chunk]),
    );
    const baselineChunks = this.rankEvidenceChunks([...baselineMap.values()]);
    const subQuestionAttempted = new Set(
      [
        ...newQuestions,
        ...(validFastPathReuse && state.retryCount === 0
          ? attemptedQuestions
          : []),
      ].map((item) => item.id),
    );
    const updatedSubQuestions: AgenticSubQuestion[] = boundedSubQuestions.map(
      (subQuestion) => {
        const gate = this.assessRetrievedChunks(
          subQuestion.question,
          baselineChunks,
          retrieveOptions.queryPlan?.taskType,
        );
        const coverage = gate.coverage?.[0];
        const evidenceIds = Array.from(
          new Set([
            ...subQuestion.evidenceIds,
            ...(coverage?.evidenceIds ??
              (gate.sufficient ? baselineChunks.map((chunk) => chunk.id) : [])),
          ]),
        ).filter((id) => baselineMap.has(id));
        return {
          ...subQuestion,
          status: gate.sufficient ? 'sufficient' : 'needs_more',
          sufficient: gate.sufficient,
          reason: gate.reason,
          evidenceIds,
          retrievalAttempts:
            subQuestion.retrievalAttempts +
            (subQuestionAttempted.has(subQuestion.id) ? 1 : 0),
        };
      },
    );
    const remainingSubQuestions = plannedSubQuestions
      .slice(boundedSubQuestions.length)
      .map((item) => ({ ...item, status: 'needs_more' as const }));
    const priorCoverage = (state.subQuestions ?? []).filter(
      (item) => item.sufficient,
    ).length;
    const currentCoverage = updatedSubQuestions.filter(
      (item) => item.sufficient,
    ).length;
    const priorIds = new Set(priorChunks.map((chunk) => chunk.id));
    const newEvidenceCount = baselineChunks.filter(
      (chunk) => !priorIds.has(chunk.id),
    ).length;
    const retrievalReasonCode = retrievalFailure
      ? 'source_failure'
      : duplicateRetrievalSkipped &&
          updatedSubQuestions.some((item) => !item.sufficient)
        ? 'duplicate_retrieval_skipped'
        : latestRetrievalStatus === 'no_result'
          ? 'no_evidence'
          : latestRetrievalStatus === 'hit' && newEvidenceCount === 0
            ? 'no_information_gain'
            : latestRetrievalStatus === 'hit'
              ? 'candidates_retrieved'
              : state.retrievalReasonCode;
    const stoppedReason =
      duplicateRetrievalSkipped &&
      updatedSubQuestions.some((item) => !item.sufficient)
        ? 'same_retrieval_fingerprint_without_new_evidence'
        : '';

    const resultIds = new Set(baselineChunks.map((chunk) => chunk.id));
    const deterministicAnswer = this.buildEvidenceFirstAnswer(
      state.query,
      baselineChunks,
    );
    const deterministicChunks = deterministicAnswer
      ? [...deterministicAnswer.matchAll(/\[片段\s*(\d+)\]/g)]
          .map((match) => baselineChunks[Number(match[1]) - 1])
          .filter((chunk): chunk is RetrievedChunk => Boolean(chunk))
      : [];
    const requiredIds = updatedSubQuestions.flatMap((item) => item.evidenceIds);
    const requiredChunks = requiredIds
      .map((id) => baselineMap.get(id))
      .filter((chunk): chunk is RetrievedChunk => Boolean(chunk));
    const preservedChunks = priorChunks.filter(
      (chunk) =>
        chunk.id.startsWith('web:') || chunk.retrievalSource === 'attachment',
    );
    const chunks = this.uniqueChunks([
      ...requiredChunks,
      ...deterministicChunks,
      ...preservedChunks,
      ...baselineChunks,
    ]).slice(0, this.maxRetrievedChunks);

    this.logger.log(
      `Retrieved ${chunks.length} unique chunks; newEvidenceCount=${newEvidenceCount}; coverageDelta=${currentCoverage - priorCoverage}`,
    );

    onEvent?.({
      type: 'retrieval',
      data: {
        chunks,
        subQuestions: [...updatedSubQuestions, ...remainingSubQuestions].map(
          (item) => ({ ...item, evidenceCount: item.evidenceIds.length }),
        ),
        evidenceCount: resultIds.size,
        retrievalAttempt: Math.max(
          0,
          ...updatedSubQuestions.map((item) => item.retrievalAttempts),
        ),
        retrievalFingerprint: executedFingerprints[0],
        newEvidenceCount,
        coverageDelta: currentCoverage - priorCoverage,
        fastPathReused: validFastPathReuse,
        duplicateRetrievalSkipped,
        stoppedReason,
        reasonCode: retrievalReasonCode,
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
        reasonCode: retrievalReasonCode,
      },
    );
    onEvent?.({ type: 'artifact', data: evidenceArtifact });
    if (chunks.length === 0) {
      this.metricsService.observeAgentEmptyRetrieval(state.route || 'agentic');
    }
    return {
      retrievedChunks: chunks,
      subQuestions: [...updatedSubQuestions, ...remainingSubQuestions],
      retrievalFingerprints: allFingerprints,
      retrievalStatus: latestRetrievalStatus,
      retrievalReasonCode,
      artifacts: [...previousArtifacts, evidenceArtifact],
      webSearchAttempted: state.webSearchAttempted,
      webSearchCount: state.webSearchCount,
      answer: '',
      passed: false,
    };
  }

  private uniqueChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
    const unique = new Map<string, RetrievedChunk>();
    for (const chunk of chunks) {
      const existing = unique.get(chunk.id);
      if (
        !existing ||
        this.rankEvidenceChunks([existing, chunk])[0] === chunk
      ) {
        unique.set(chunk.id, chunk);
      }
    }
    return [...unique.values()];
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
        retrievedChunks: rerankedChunks,
        reranked: true,
      };
    } catch (error) {
      await this.rethrowIfAbortedOrCancelled(error, config);
      this.logger.warn(`Rerank failed: ${(error as Error).message}`);
      onEvent?.({
        type: 'rerank',
        data: {
          enabled: true,
          reranked: false,
          count: state.retrievedChunks.length,
          error: (error as Error).message,
        },
      });
      return { reranked: false };
    }
  }
}
