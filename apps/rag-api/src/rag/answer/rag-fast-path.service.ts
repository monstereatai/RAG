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
import type { EvidenceAssessment } from '../evidence/evidence-bundle';
import { buildEvidenceSourceStatuses } from '../evidence/evidence-source-status';
import { retrievalFingerprintsForPlan } from '../evidence/retrieval-fingerprint';
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
    assessment: EvidenceAssessment;
    chunks: RetrievedChunk[];
    obsidianHits: ObsidianSearchHit[];
    prefetchedFastPath: PrefetchedFastPath;
  }> {
    const normalizedQuery = this.retrievalService.normalizeQuery(query);
    const sourcePolicy =
      options.executionPlan?.sourcePolicy ??
      options.sourcePolicy ??
      'local_only';
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
              this.logger.warn('Fast path Base Case retrieval failed');
              return [] as BadCaseMatch[];
            }),
      this.retrievalService
        .retrieveWithContextualQuery(normalizedQuery, options, userId)
        .catch((error) => {
          retrievalFailure = (error as Error).message;
          this.logger.warn('Fast path RAG retrieval failed');
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
              this.logger.warn('Fast path Obsidian retrieval failed');
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
    const obsidianChunks =
      this.obsidianService.toObsidianChunks(evidenceObsidianHits);
    const candidateChunks = [...chunks, ...obsidianChunks];
    const requiredAspects = options.queryPlan?.subQueries ?? [];
    const evidenceAssessment = this.answerQuality.assessRetrievalQuality(
      normalizedQuery,
      candidateChunks,
      options.queryPlan?.taskType ?? 'lookup',
      requiredAspects,
    );
    const sourceStatuses = buildEvidenceSourceStatuses({
      badCaseMatches,
      retrieval: retrievalWithSources,
      obsidianHits: evidenceObsidianHits,
      sourcePolicy,
      failures: { badCaseFailure, retrievalFailure, obsidianFailure },
    });
    const sourceFailure = sourceStatuses.some((source) =>
      ['failure', 'timeout'].includes(source.status),
    );
    const assessment = {
      ...evidenceAssessment,
      reason: `${evidenceAssessment.reason}; Base Case: ${baseCaseGate.reason}; RAG 候选 ${retrievalWithSources.chunks.length} 个；Obsidian 候选 ${obsidianChunks.length} 个`,
      ...(candidateChunks.length === 0 && sourceFailure
        ? {
            status: 'source_error' as const,
            reasonCode: 'source_failure',
            reason: '本地证据源调用失败，无法完成检索判断',
          }
        : {}),
      evaluatedQuery: query,
    };
    const retrievalFingerprints = retrievalFingerprintsForPlan(
      normalizedQuery,
      userId,
      options,
      options.executionPlan,
    );
    const evidenceBundle = createEvidenceBundle({
      query,
      chunks: candidateChunks,
      assessment,
      sourcePolicy,
      diagnostics: retrievalWithSources.diagnostics,
      sourceStatuses,
      subquestionCoverage: evidenceAssessment.coverage,
      retrievalFingerprints,
      retrievalAttempted: true,
    });

    return {
      sufficient: evidenceBundle.assessment.sufficient,
      reason: evidenceBundle.assessment.reason,
      assessment: evidenceBundle.assessment,
      chunks: evidenceBundle.chunks,
      obsidianHits: evidenceObsidianHits,
      prefetchedFastPath: {
        retrieval: retrievalWithSources,
        obsidianHits: evidenceObsidianHits,
        badCaseMatches,
        evidenceBundle,
        retrievalFingerprints,
        retrievalAttempted: true,
      },
    };
  }
}
