import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import type { DocumentRetrievalDescriptionService } from '../../modules/document/document-retrieval-description.service';
import type { DashScopeRerankService } from '../../tools/dashscope-rerank.service';
import { BM25 } from '../indexing/bm25.util';
import type { Bm25PersistedEntry } from '../indexing/bm25-store';
import type { RankedRetrievalHit } from '../indexing/rag-index.types';
import { RagIndexService } from '../indexing/rag-index.service';
import type {
  RetrievedChunk,
  RetrievalScope,
} from '../evidence/retrieval.types';
import type { RetrievalProfile } from './context-builder';
import { normalizeQuery } from './query-normalizer';
import { RetrievalPostprocessor } from './retrieval-postprocessor';
import type { IndexedChunk } from './retrieval-postprocessor';

type RetrievalDescriptionHit = Awaited<
  ReturnType<DocumentRetrievalDescriptionService['searchByVector']>
>[number];

@Injectable()
export class RagChunkPolicyService {
  private readonly logger = new Logger(RagChunkPolicyService.name);
  private readonly retrievalPostprocessor: RetrievalPostprocessor;

  private get persistedEntries(): readonly Bm25PersistedEntry[] {
    return this.indexService.getPersistedEntries();
  }

  private get chunkMeta() {
    return this.indexService.getChunkMeta();
  }

  constructor(
    configService: ConfigService,
    private readonly indexService: RagIndexService,
    @Optional() rerankService?: DashScopeRerankService,
  ) {
    this.retrievalPostprocessor = new RetrievalPostprocessor(
      configService,
      rerankService,
    );
  }

  mergeRankedHits(
    primaryHits: RankedRetrievalHit[],
    fallbackHits: RankedRetrievalHit[],
    limit = 10,
  ): RankedRetrievalHit[] {
    return this.retrievalPostprocessor.mergeRankedHits(
      primaryHits,
      fallbackHits,
      limit,
    );
  }

  pickChunkMetadata(
    chunk: Partial<RetrievedChunk>,
  ): Pick<
    RetrievedChunk,
    | 'parentChunkId'
    | 'headingPath'
    | 'sectionId'
    | 'clauseId'
    | 'tableRef'
    | 'sourceStart'
    | 'sourceEnd'
    | 'parentContent'
    | 'sourceMetadata'
    | 'docVersion'
    | 'effectiveAt'
    | 'expiredAt'
    | 'sourceAuthority'
    | 'projectId'
    | 'activityId'
    | 'region'
    | 'locale'
    | 'channel'
    | 'roleScope'
    | 'documentType'
    | 'lifecycleStatus'
    | 'supersedesDocId'
    | 'ruleKey'
    | 'changeType'
    | 'supersedesChunkId'
  > {
    return this.retrievalPostprocessor.pickChunkMetadata(chunk);
  }

  applySourceAuthority(chunks: RetrievedChunk[]): RetrievedChunk[] {
    return this.retrievalPostprocessor.applySourceAuthority(chunks);
  }

  /** 描述只负责找到原文位置，进入候选列表和最终引用的始终是原文 chunk。 */
  mapDescriptionHitsToSourceChunks(
    descriptionHits: RetrievalDescriptionHit[],
    query: string,
    allowedDocIds: Set<string> | null,
    userId?: string,
    scope?: RetrievalScope,
    authoritativeEntries?: readonly Bm25PersistedEntry[],
  ): Awaited<ReturnType<VectorStoreProvider['similaritySearch']>> {
    const entriesById = new Map(
      (authoritativeEntries ?? this.persistedEntries).map((entry) => [entry.id, entry]),
    );
    const byChunkId = new Map<
      string,
      Awaited<ReturnType<VectorStoreProvider['similaritySearch']>>[number]
    >();

    for (const description of descriptionHits) {
      const isAllowed = allowedDocIds
        ? allowedDocIds.has(description.docId)
        : !userId || description.userId === userId;
      if (!isAllowed) continue;

      const entries = description.sourceChunkIds.flatMap((id) => {
        const entry = entriesById.get(id);
        if (
          !entry ||
          entry.docId !== description.docId ||
          (entry.indexGeneration ?? null) !== description.indexGeneration ||
          (entry.docVersion ?? null) !== description.docVersion ||
          (description.userId && entry.userId !== description.userId) ||
          !this.retrievalPostprocessor.isLifecycleVisible(entry, scope) ||
          !this.retrievalPostprocessor.matchesScope(entry, scope)
        ) {
          return [];
        }
        return [entry];
      });
      if (entries.length === 0) continue;

      // 摘要可能关联整篇文档。先在命中的原文块里按问题做 BM25，避免把整篇塞进上下文。
      const localBm25 = new BM25();
      localBm25.addDocs(
        entries.map((entry) => ({
          id: entry.id,
          content: entry.content,
          searchText: `${entry.content}\n${(entry.hypotheticalQuestions ?? []).join('\n')}`,
        })),
      );
      const localHits = localBm25.search(query, entries.length);
      const rankById = new Map(localHits.map((hit, index) => [hit.id, index]));
      const orderedEntries = [...entries].sort((left, right) => {
        const leftRank = rankById.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = rankById.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank || left.chunkIndex - right.chunkIndex;
      });
      const maxPerDescription = Math.max(
        2,
        Math.min(8, Math.ceil(entries.length / 4)),
      );

      orderedEntries.slice(0, maxPerDescription).forEach((entry, index) => {
        const score = description.score + (maxPerDescription - index) * 1e-6;
        const existing = byChunkId.get(entry.id);
        if (!existing || score > existing.score) {
          byChunkId.set(entry.id, {
            id: entry.id,
            content: entry.content,
            docId: entry.docId,
            chunkIndex: entry.chunkIndex,
            score,
          });
        }
      });
    }

    return [...byChunkId.values()].sort(
      (left, right) => right.score - left.score,
    );
  }

  /** 在原文向量结果与描述命中的原文之间做一次排名融合，并按 chunk ID 去重。 */

  fuseByRrf(
    bm25Hits: RankedRetrievalHit[],
    cosineHits: Awaited<ReturnType<VectorStoreProvider['similaritySearch']>>,
  ): RetrievedChunk[] {
    return this.retrievalPostprocessor.fuseByRrf(
      this.chunkMeta,
      bm25Hits,
      cosineHits,
    );
  }

  rankScore(index: number): number {
    return this.retrievalPostprocessor.rankScore(index);
  }

  applySourceAuthorityToChunk(chunk: RetrievedChunk): RetrievedChunk {
    return this.retrievalPostprocessor.applySourceAuthorityToChunk(chunk);
  }

  private filterActiveVectorHits(
    hits: Awaited<ReturnType<VectorStoreProvider['similaritySearch']>>,
    userId?: string,
    allowedDocIds?: ReadonlySet<string>,
    scope?: RetrievalScope,
  ): Awaited<ReturnType<VectorStoreProvider['similaritySearch']>> {
    return this.retrievalPostprocessor.filterActiveVectorHits(
      this.chunkMeta,
      hits,
      userId,
      allowedDocIds,
      scope,
    );
  }

  /**
   * DashScope 重排：在 authority/scope 过滤排序后、最终截断前，对前 RAG_RERANK_TOP_N 个候选重排。
   * 只按重排分调整顺序并挂 rerankScore；totalScore 保留融合分，保证下游质量闸门口径不变。
   * RAG_RERANK_ENABLED=false、rerank 未配置 key 或调用失败时保持原序，绝不抛错阻断检索。
   */
  async applyRerank(
    query: string,
    chunks: RetrievedChunk[],
    signal?: AbortSignal,
  ): Promise<{ chunks: RetrievedChunk[]; applied: boolean }> {
    return this.retrievalPostprocessor.applyRerank(query, chunks, signal);
  }

  matchesScope(
    chunk: Partial<RetrievedChunk>,
    scope: RetrievalScope = {},
  ): boolean {
    return this.retrievalPostprocessor.matchesScope(chunk, scope);
  }

  isLifecycleVisible(
    chunk: Partial<RetrievedChunk>,
    scope?: RetrievalScope,
  ): boolean {
    return this.retrievalPostprocessor.isLifecycleVisible(chunk, scope);
  }

  isEvidenceDocumentVisible(
    docId: string,
    userId: string | undefined,
    allowedDocIds: ReadonlySet<string> | undefined,
    scope?: RetrievalScope,
  ): boolean {
    if (!userId || !allowedDocIds?.has(docId)) return false;
    const entries = this.persistedEntries.filter(
      (entry) =>
        entry.docId === docId &&
        (allowedDocIds != null
          ? allowedDocIds.has(entry.docId)
          : entry.userId === userId),
    );
    return entries.some(
      (entry) =>
        this.retrievalPostprocessor.isLifecycleVisible(entry, scope) &&
        this.retrievalPostprocessor.matchesScope(entry, scope),
    );
  }

  expandContextChunks(
    hits: RetrievedChunk[],
    profile: RetrievalProfile,
    userId?: string,
    scope?: RetrievalScope,
    allowedDocIds?: ReadonlySet<string>,
  ): RetrievedChunk[] {
    return this.expandContextChunksFrom(
      this.persistedEntries,
      hits,
      profile,
      userId,
      scope,
      allowedDocIds,
    );
  }

  expandContextChunksFrom(
    sourceEntries: readonly IndexedChunk[],
    hits: RetrievedChunk[],
    profile: RetrievalProfile,
    userId?: string,
    scope?: RetrievalScope,
    allowedDocIds?: ReadonlySet<string>,
  ): RetrievedChunk[] {
    return this.retrievalPostprocessor.expandContextChunks(
      sourceEntries,
      hits,
      profile,
      userId,
      scope,
      allowedDocIds,
    );
  }

  normalizeQuery(query: string): string {
    return normalizeQuery(query);
  }
}
