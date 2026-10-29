import { Injectable, Logger } from '@nestjs/common';
import {
  BadCaseFlywheelService,
  type BadCaseMatch,
} from '../prompts/bad-case-flywheel.service';
import {
  ObsidianKnowledgeService,
  type ObsidianSearchHit,
} from '../../modules/obsidian/obsidian-knowledge.service';
import type {
  DetailedRetrievalResult,
  RetrievedChunk,
} from '../evidence/retrieval.types';
import type {
  PrefetchedFastPath,
  RetrieveOptions,
} from '../contracts/rag-types';
import { createEvidenceBundle } from '../evidence/evidence-bundle';
import { buildEvidenceSourceStatuses } from '../evidence/evidence-source-status';
import { RagEvidenceService } from '../evidence/rag-evidence.service';
import { RagObsidianService } from '../evidence/rag-obsidian.service';
import { retrievalProfileForTaskType } from '../retrieval/context-builder';
import { RagRetrievalService } from '../retrieval/rag-retrieval.service';
import {
  hasExplicitDocumentScope,
  isSupplementalEvidenceRestricted,
} from '../retrieval/scope-policy';

@Injectable()
export class RagFastPathService {
  private readonly logger = new Logger(RagFastPathService.name);

  private get answerQuality() {
    return this.evidenceService.answerQuality;
  }

  constructor(
    private readonly retrievalService: RagRetrievalService,
    private readonly evidenceService: RagEvidenceService,
    private readonly obsidianKnowledge: ObsidianKnowledgeService,
    private readonly obsidianService: RagObsidianService,
    private readonly badCaseFlywheel: BadCaseFlywheelService,
  ) {}

  async assessFastPath(
    query: string,
    userId?: string,
    options: RetrieveOptions = {},
  ): Promise<{
    sufficient: boolean;
    reason: string;
    chunks: RetrievedChunk[];
    obsidianHits: ObsidianSearchHit[];
    prefetchedFastPath: PrefetchedFastPath;
  }> {
    const normalizedQuery = this.retrievalService.normalizeQuery(query);
    let badCaseFailure: string | undefined;
    let retrievalFailure: string | undefined;
    let obsidianFailure: string | undefined;
    const scopeRestricted = isSupplementalEvidenceRestricted(options);
    const baseCaseRestricted = hasExplicitDocumentScope(options.scope);
    const [badCaseMatches, retrieval, obsidianHits] = await Promise.all([
      baseCaseRestricted
        ? Promise.resolve([] as BadCaseMatch[])
        : this.badCaseFlywheel
            .retrieveMatches(normalizedQuery, 2, userId, options.tenantId)
            .catch((error) => {
              badCaseFailure = (error as Error).message;
              this.logger.warn(
                `Fast path Base Case retrieval failed: ${(error as Error).message}`,
              );
              return [] as BadCaseMatch[];
            }),
      this.retrievalService
        .retrieveWithContextualQuery(normalizedQuery, options, userId)
        .catch((error) => {
          retrievalFailure = (error as Error).message;
          this.logger.warn(
            `Fast path RAG retrieval failed: ${(error as Error).message}`,
          );
          return {
            chunks: [] as RetrievedChunk[],
            diagnostics: {
              intent: retrievalProfileForTaskType(
                options.queryPlan?.taskType ?? 'lookup',
              ).intent,
              candidateDepth: 0,
              expandedChunks: 0,
              duplicateChunksRemoved: 0,
              documentLimitRemoved: 0,
              budgetRemoved: 0,
              contextCharacters: 0,
            },
            profile: retrievalProfileForTaskType(
              options.queryPlan?.taskType ?? 'lookup',
            ),
          } satisfies DetailedRetrievalResult;
        }),
      scopeRestricted
        ? Promise.resolve([] as ObsidianSearchHit[])
        : this.obsidianKnowledge
            .search(normalizedQuery, 5, {
              userId,
              roles: options.scope?.role ? [options.scope.role] : [],
            })
            .catch((error) => {
              obsidianFailure = (error as Error).message;
              this.logger.warn(
                `Fast path Obsidian retrieval failed: ${(error as Error).message}`,
              );
              return [] as ObsidianSearchHit[];
            }),
    ]);
    const sourceResolution =
      await this.obsidianService.resolveObsidianSourceEvidence(
        normalizedQuery,
        obsidianHits,
        userId,
        options,
      );
    const evidenceObsidianHits = obsidianHits.filter(
      (hit) => !sourceResolution.sourceNotePaths.has(hit.path),
    );
    const retrievalChunkMap = new Map<string, RetrievedChunk>();
    for (const chunk of [...retrieval.chunks, ...sourceResolution.chunks]) {
      const existing = retrievalChunkMap.get(chunk.id);
      if (!existing || chunk.totalScore > existing.totalScore) {
        retrievalChunkMap.set(chunk.id, chunk);
      }
    }
    const retrievalWithSources: DetailedRetrievalResult = {
      ...retrieval,
      chunks: Array.from(retrievalChunkMap.values()),
    };
    const reviewedBaseCaseChunks =
      this.evidenceService.toReviewedEvidenceChunks(badCaseMatches);
    const chunks = [...reviewedBaseCaseChunks, ...retrievalWithSources.chunks];
    const baseCaseGate = this.evidenceService.assessReviewedBaseCaseEvidence(
      badCaseMatches,
      reviewedBaseCaseChunks,
    );
    const attachmentEvidenceCount = retrievalWithSources.chunks.filter(
      (chunk) => chunk.retrievalSource === 'attachment',
    ).length;
    const ragGate =
      attachmentEvidenceCount > 0
        ? {
            sufficient: true,
            reason: `当前会话附件命中 ${attachmentEvidenceCount} 个片段`,
          }
        : retrievalWithSources.chunks.length === 0
          ? { sufficient: false, reason: 'RAG 没有检索到候选片段' }
          : this.answerQuality.assessRetrievalQuality(
              normalizedQuery,
              retrievalWithSources.chunks,
              options.queryPlan?.taskType ?? 'lookup',
            );
    const obsidianGate = this.obsidianKnowledge.assessHits(
      normalizedQuery,
      evidenceObsidianHits,
    );

    const assessment = {
      sufficient:
        baseCaseGate.sufficient ||
        ragGate.sufficient ||
        obsidianGate.sufficient,
      reason: `Base Case: ${baseCaseGate.reason}; RAG: ${ragGate.reason}; Obsidian: ${obsidianGate.reason}`,
      evaluatedQuery: query,
    };
    const evidenceBundle = createEvidenceBundle({
      query,
      chunks,
      assessment,
      sourcePolicy: options.sourcePolicy ?? 'web_allowed',
      diagnostics: retrievalWithSources.diagnostics,
      sourceStatuses: buildEvidenceSourceStatuses({
        badCaseMatches,
        retrieval: retrievalWithSources,
        obsidianHits: evidenceObsidianHits,
        sourcePolicy: options.sourcePolicy ?? 'web_allowed',
        failures: { badCaseFailure, retrievalFailure, obsidianFailure },
      }),
    });

    return {
      sufficient: evidenceBundle.assessment.sufficient,
      reason: evidenceBundle.assessment.reason,
      chunks: evidenceBundle.chunks,
      obsidianHits: evidenceObsidianHits,
      prefetchedFastPath: {
        retrieval: retrievalWithSources,
        obsidianHits: evidenceObsidianHits,
        badCaseMatches,
        evidenceBundle,
      },
    };
  }
}
