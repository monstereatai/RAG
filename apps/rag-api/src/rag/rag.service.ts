import {
  AgenticFastPathCapability,
  AgenticRetrievalCapability,
  AgenticSimpleAnswerCapability,
  AgenticSupportingEvidenceCapability,
} from './contracts/agentic-rag-capabilities';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { ObsidianSearchHit } from '../modules/obsidian/obsidian-knowledge.service';
import type { BadCaseMatch } from './prompts/bad-case-flywheel.service';
import type { QueryTaskType } from './planning/query-plan';
import type {
  DetailedRetrievalResult,
  RetrievalScope,
  RetrievedChunk,
} from './evidence/retrieval.types';
import type { RetrievalExecutionPlan } from './contracts/retrieval-execution-plan';
import type {
  PrefetchedFastPath,
  RagAnswerResult,
  RetrieveOptions,
} from './contracts/rag-types';
import type {
  RagAdminCapability,
  RagChunkMetadataPatch,
  RagIndexCapability,
  RagIndexChunkInput,
  RagQueryCapability,
  RagRetrievalCapability,
} from './contracts/rag-capabilities';
import { RagIndexService } from './indexing/rag-index.service';
import { RagRetrievalService } from './retrieval/rag-retrieval.service';
import { RagEvidenceService } from './evidence/rag-evidence.service';
import { RagObsidianService } from './evidence/rag-obsidian.service';
import { RagAnswerService } from './answer/rag-answer.service';

/**
 * Stable RAG composition facade.
 *
 * All behavior lives in focused components; this class only joins their
 * capabilities and keeps the public application boundary stable.
 */
@Injectable()
export class RagService
  implements
    OnModuleInit,
    AgenticRetrievalCapability,
    AgenticFastPathCapability,
    AgenticSimpleAnswerCapability,
    AgenticSupportingEvidenceCapability,
    RagQueryCapability,
    RagRetrievalCapability,
    RagIndexCapability,
    RagAdminCapability
{
  constructor(
    private readonly indexService: RagIndexService,
    private readonly retrievalService: RagRetrievalService,
    private readonly evidenceService: RagEvidenceService,
    private readonly obsidianService: RagObsidianService,
    private readonly answerService: RagAnswerService,
  ) {}

  onModuleInit(): void {
    this.indexService.onModuleInit();
  }

  indexChunks(chunks: RagIndexChunkInput[], userId?: string): void {
    this.indexService.indexChunks(chunks, userId);
  }

  removeDocChunks(docId: string, userId?: string): void {
    this.indexService.removeDocChunks(docId, userId);
  }

  removeChunkIds(ids: string[], userId?: string): void {
    this.indexService.removeChunkIds(ids, userId);
  }

  updateChunkMetadataByIds(ids: string[], patch: RagChunkMetadataPatch): void {
    this.indexService.updateChunkMetadataByIds(ids, patch);
  }

  updateDocumentLifecycle(
    docId: string,
    lifecycleStatus: string,
    userId?: string,
  ): void {
    this.indexService.updateDocumentLifecycle(docId, lifecycleStatus, userId);
  }

  getIndexedDocIds(): Set<string> {
    return this.indexService.getIndexedDocIds();
  }

  getIndexedChunkCount(docId: string, userId?: string): number {
    return this.indexService.getIndexedChunkCount(docId, userId);
  }

  getIndexedChunkHashes(
    docId: string,
    userId?: string,
  ): {
    hashes: string[];
    generations: string[];
    lifecycleStatuses: string[];
    complete: boolean;
  } {
    return this.indexService.getIndexedChunkHashes(docId, userId);
  }

  getSnapshotPersistenceStatus(docId: string): {
    persisted: boolean;
    reason?: string;
  } {
    return this.indexService.getSnapshotPersistenceStatus(docId);
  }

  getStats(): { totalChunks: number; totalDocs: number } {
    return this.indexService.getStats();
  }

  hasIndexedChunks(userId?: string): boolean {
    return this.indexService.hasIndexedChunks(userId);
  }

  retrieve(
    query: string,
    options: RetrieveOptions = {},
    userId?: string,
  ): Promise<RetrievedChunk[]> {
    return this.retrievalService.retrieve(query, options, userId);
  }

  retrieveByPlan(
    executionPlan: RetrievalExecutionPlan,
    options: RetrieveOptions = {},
    userId?: string,
  ): Promise<DetailedRetrievalResult> {
    return this.retrievalService.retrieveByPlan(executionPlan, options, userId);
  }

  retrieveDetailed(
    query: string,
    options: RetrieveOptions = {},
    userId?: string,
  ): Promise<DetailedRetrievalResult> {
    return this.retrievalService.retrieveDetailed(query, options, userId);
  }

  retrieveWithContextualQuery(
    query: string,
    options: RetrieveOptions,
    userId?: string,
  ): Promise<DetailedRetrievalResult> {
    return this.retrievalService.retrieveWithContextualQuery(
      query,
      options,
      userId,
    );
  }

  retrieveBm25Only(
    query: string,
    userId?: string,
    scope?: RetrievalScope,
    includeElasticsearch = true,
    tenantId?: string,
    roles: string[] = [],
    departmentIds: string[] = [],
    trustedAdminPrincipal = false,
  ): Promise<RetrievedChunk[]> {
    return this.retrievalService.retrieveBm25Only(
      query,
      userId,
      scope,
      includeElasticsearch,
      tenantId,
      roles,
      departmentIds,
      trustedAdminPrincipal,
    );
  }

  retrieveReviewedEvidence(
    query: string,
    limit = 2,
    userId?: string,
    tenantId?: string,
  ): Promise<RetrievedChunk[]> {
    return this.evidenceService.retrieveReviewedEvidence(
      query,
      limit,
      userId,
      tenantId,
    );
  }

  assessRetrievedChunks(
    query: string,
    chunks: RetrievedChunk[],
    taskType: QueryTaskType = 'lookup',
  ): { sufficient: boolean; reason: string } {
    return this.evidenceService.assessRetrievedChunks(query, chunks, taskType);
  }

  answer(
    query: string,
    history: Array<{ role: 'human' | 'ai'; content: string }> = [],
    userId?: string,
    memoryMessages: Array<{ role: string; content: string }> = [],
    onToken?: (token: string) => void,
    retrieveOptions: RetrieveOptions = {},
  ): Promise<RagAnswerResult> {
    return this.answerService.answer(
      query,
      history,
      userId,
      memoryMessages,
      onToken,
      retrieveOptions,
    );
  }

  assessFastPath(
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
    return this.answerService.assessFastPath(query, userId, options);
  }

  unsupportedReliableAnswer(): string {
    return this.answerService.unsupportedReliableAnswer();
  }

  extractCorrectedAnswer(text: string): string {
    return this.evidenceService.extractCorrectedAnswer(text);
  }

  generateCorrectionAnswer(
    query: string,
    correction: string,
    history: Array<{ role: 'human' | 'ai'; content: string }>,
    memoryMessages: Array<{ role: string; content: string }>,
    onToken?: (token: string) => void,
    reviewedQuery?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.evidenceService.generateCorrectionAnswer(
      query,
      correction,
      history,
      memoryMessages,
      onToken,
      reviewedQuery,
      signal,
    );
  }

  toReviewedEvidenceChunks(matches: BadCaseMatch[]): RetrievedChunk[] {
    return this.evidenceService.toReviewedEvidenceChunks(matches);
  }

  assessReviewedBaseCaseEvidence(
    matches: BadCaseMatch[],
    chunks: RetrievedChunk[],
  ): { sufficient: boolean; reason: string } {
    return this.evidenceService.assessReviewedBaseCaseEvidence(matches, chunks);
  }

  assessRetrievalQuality(
    query: string,
    chunks: RetrievedChunk[],
    taskType: QueryTaskType = 'lookup',
  ): { sufficient: boolean; reason: string } {
    return this.evidenceService.assessRetrievalQuality(query, chunks, taskType);
  }

  assessCitationSupport(
    answer: string,
    chunks: RetrievedChunk[],
  ): { sufficient: boolean; reason: string } {
    return this.evidenceService.assessCitationSupport(answer, chunks);
  }

  validateAnswerCitationSupport(
    answer: string,
    chunks: RetrievedChunk[],
  ): { sufficient: boolean; reason: string } {
    return this.evidenceService.validateAnswerCitationSupport(answer, chunks);
  }

  expandRuleCompanions(
    chunks: RetrievedChunk[],
    scope?: RetrievalScope,
  ): RetrievedChunk[] {
    return this.evidenceService.expandRuleCompanions(chunks, scope);
  }

  rankEvidenceChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
    return this.evidenceService.rankEvidenceChunks(chunks);
  }

  prepareGroundedEvidence(
    chunks: RetrievedChunk[],
    scope?: RetrievalScope,
  ): RetrievedChunk[] {
    return this.evidenceService.prepareGroundedEvidence(chunks, scope);
  }

  generateGroundedAnswer(
    query: string,
    chunks: RetrievedChunk[],
    history: Array<{ role: 'human' | 'ai'; content: string }> = [],
    memoryMessages: Array<{ role: string; content: string }> = [],
    onToken?: (token: string) => void,
    options: {
      userId?: string;
      scope?: RetrievalScope;
      entities?: string[];
      needsSynthesis?: boolean;
      answerRequirements?: string[];
      preferAgenticModel?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<RagAnswerResult> {
    return this.evidenceService.generateGroundedAnswer(
      query,
      chunks,
      history,
      memoryMessages,
      onToken,
      options,
    );
  }

  repairAnswerCitations(answer: string, chunks: RetrievedChunk[]): string {
    return this.evidenceService.repairAnswerCitations(answer, chunks);
  }

  selectCitedChunks(
    answer: string,
    chunks: RetrievedChunk[],
  ): RetrievedChunk[] {
    return this.evidenceService.selectCitedChunks(answer, chunks);
  }

  buildEvidenceFirstAnswer(
    query: string,
    chunks: RetrievedChunk[],
  ): string | null {
    return this.evidenceService.buildEvidenceFirstAnswer(query, chunks);
  }

  buildDeterministicAnswer(
    query: string,
    chunks: RetrievedChunk[],
  ): string | null {
    return this.evidenceService.buildDeterministicAnswer(query, chunks);
  }

  buildCitationSafeExtractiveAnswer(
    query: string,
    chunks: RetrievedChunk[],
  ): string | null {
    return this.evidenceService.buildCitationSafeExtractiveAnswer(
      query,
      chunks,
    );
  }

  toReferences(chunks: RetrievedChunk[]): RagAnswerResult['references'] {
    return this.evidenceService.toReferences(chunks);
  }

  getObsidianContext(
    query: string,
    userId?: string,
    role?: string,
  ): Promise<{ hits: ObsidianSearchHit[]; context: string }> {
    return this.obsidianService.getObsidianContext(query, userId, role);
  }

  formatObsidianContext(hits: ObsidianSearchHit[]): string {
    return this.obsidianService.formatObsidianContext(hits);
  }

  toObsidianChunks(hits: ObsidianSearchHit[]): RetrievedChunk[] {
    return this.obsidianService.toObsidianChunks(hits);
  }

  resolveObsidianSourceEvidence(
    query: string,
    hits: ObsidianSearchHit[],
    userId?: string,
    options: Pick<
      RetrieveOptions,
      'tenantId' | 'scope' | 'roles' | 'departmentIds' | 'trustedAdminPrincipal'
    > = {},
  ): Promise<{
    chunks: RetrievedChunk[];
    mappedDocIds: Set<string>;
    sourceNotePaths: Set<string>;
  }> {
    return this.obsidianService.resolveObsidianSourceEvidence(
      query,
      hits,
      userId,
      options,
    );
  }
}
