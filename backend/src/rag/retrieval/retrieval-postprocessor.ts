import { isEffectiveDuring } from './effective-time';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VectorStoreProvider } from '../../providers/vector-store/vector-store.provider';
import type { DashScopeRerankService } from '../../tools/dashscope-rerank.service';
import { canonicalizeRole } from '../../modules/chat/role-presets';
import type {
  RetrievedChunk,
  RetrievalScope,
} from '../evidence/retrieval.types';
import type { RetrievalProfile } from './context-builder';

export type IndexedChunk = Pick<
  RetrievedChunk,
  'id' | 'content' | 'docId' | 'chunkIndex'
> &
  Partial<RetrievedChunk> & { userId?: string };
export type RankedRetrievalHit = IndexedChunk & { score: number };

/** Source-independent candidate processing. Index state is supplied by the caller. */
export class RetrievalPostprocessor {
  private readonly logger = new Logger('RagService');
  private readonly bm25Weight = 0.3;
  private readonly cosineWeight = 0.7;
  private readonly rrfK = 60;

  constructor(
    private readonly configService: ConfigService,
    private readonly rerankService?: Pick<
      DashScopeRerankService,
      'isEnabled' | 'rerank'
    >,
  ) {}

  mergeRankedHits(
    primaryHits: RankedRetrievalHit[],
    fallbackHits: RankedRetrievalHit[],
    limit = 10,
  ): RankedRetrievalHit[] {
    const merged = new Map<string, RankedRetrievalHit>();
    for (const hit of [...primaryHits, ...fallbackHits]) {
      const existing = merged.get(hit.id);
      if (!existing || hit.score > existing.score) {
        merged.set(hit.id, hit);
      }
    }
    return [...merged.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
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
    return {
      parentChunkId: chunk.parentChunkId,
      headingPath: chunk.headingPath,
      sectionId: chunk.sectionId,
      clauseId: chunk.clauseId,
      tableRef: chunk.tableRef,
      sourceStart: chunk.sourceStart,
      sourceEnd: chunk.sourceEnd,
      docVersion: chunk.docVersion,
      effectiveAt: chunk.effectiveAt,
      expiredAt: chunk.expiredAt,
      sourceAuthority: chunk.sourceAuthority,
      projectId: chunk.projectId,
      activityId: chunk.activityId,
      region: chunk.region,
      locale: chunk.locale,
      channel: chunk.channel,
      roleScope: chunk.roleScope,
      documentType: chunk.documentType,
      lifecycleStatus: chunk.lifecycleStatus,
      supersedesDocId: chunk.supersedesDocId,
      ruleKey: chunk.ruleKey,
      changeType: chunk.changeType,
      supersedesChunkId: chunk.supersedesChunkId,
    };
  }

  applySourceAuthority(chunks: RetrievedChunk[]): RetrievedChunk[] {
    return chunks.map((chunk) => this.applySourceAuthorityToChunk(chunk));
  }

  mergeVectorCandidates(
    originalHits: Awaited<ReturnType<VectorStoreProvider['similaritySearch']>>,
    descriptionHits: Awaited<
      ReturnType<VectorStoreProvider['similaritySearch']>
    >,
    limit: number,
  ): Awaited<ReturnType<VectorStoreProvider['similaritySearch']>> {
    const candidates = new Map<
      string,
      {
        hit: Awaited<
          ReturnType<VectorStoreProvider['similaritySearch']>
        >[number];
        score: number;
      }
    >();
    for (const [hits, weight] of [
      [originalHits, 1] as const,
      [descriptionHits, 1] as const,
    ]) {
      hits.forEach((hit, index) => {
        const current = candidates.get(hit.id);
        const score = this.rankScore(index) * weight;
        if (current) {
          current.score += score;
          if (hit.score > current.hit.score) current.hit = hit;
        } else {
          candidates.set(hit.id, { hit, score });
        }
      });
    }
    return [...candidates.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ hit, score }) => ({ ...hit, score }));
  }

  fuseByRrf(
    chunkMeta: ReadonlyMap<string, Omit<IndexedChunk, 'id'>>,
    bm25Hits: RankedRetrievalHit[],
    cosineHits: Awaited<ReturnType<VectorStoreProvider['similaritySearch']>>,
  ): RetrievedChunk[] {
    const bm25MaxScore = Math.max(...bm25Hits.map((hit) => hit.score), 1);
    const cosineMaxScore = Math.max(...cosineHits.map((hit) => hit.score), 1);
    const fusedMap = new Map<string, RetrievedChunk>();

    bm25Hits.forEach((hit, index) => {
      const normalizedBm25 = hit.score / bm25MaxScore;
      fusedMap.set(hit.id, {
        id: hit.id,
        content: hit.content,
        docId: hit.docId,
        chunkIndex: hit.chunkIndex,
        ...this.pickChunkMetadata(hit),
        bm25Score: normalizedBm25,
        cosineScore: 0,
        totalScore: this.rankScore(index) * this.bm25Weight,
      });
    });

    cosineHits.forEach((hit, index) => {
      const normalizedCosine = hit.score / cosineMaxScore;
      // Milvus 的 content 可能是限长副本；回答和引用使用本地索引中的完整来源片段。
      const sourceChunk = chunkMeta.get(hit.id);
      const metadata = this.pickChunkMetadata(sourceChunk ?? {});
      const rrfScore = this.rankScore(index) * this.cosineWeight;
      const existing = fusedMap.get(hit.id);

      if (existing) {
        existing.cosineScore = normalizedCosine;
        existing.totalScore += rrfScore;
        return;
      }

      fusedMap.set(hit.id, {
        id: hit.id,
        content: sourceChunk?.content ?? hit.content,
        docId: sourceChunk?.docId ?? hit.docId,
        chunkIndex: sourceChunk?.chunkIndex ?? hit.chunkIndex,
        ...metadata,
        bm25Score: 0,
        cosineScore: normalizedCosine,
        totalScore: rrfScore,
      });
    });

    return Array.from(fusedMap.values());
  }

  rankScore(index: number): number {
    return (this.rrfK + 1) / (this.rrfK + index + 1);
  }

  applySourceAuthorityToChunk(chunk: RetrievedChunk): RetrievedChunk {
    const weight = this.resolveSourceAuthorityWeight(chunk);
    if (weight === 1) {
      return chunk;
    }

    return {
      ...chunk,
      totalScore: chunk.totalScore * weight,
      sourceAuthorityWeight: weight,
    };
  }

  private resolveSourceAuthorityWeight(chunk: RetrievedChunk): number {
    const rawRules =
      this.configService.get<string>('ragQuality.sourceAuthorityRules') ?? '';
    if (!rawRules.trim()) {
      return 1;
    }

    const haystack = `${chunk.docId}\n${chunk.content}`.toLowerCase();
    let weight = 1;
    for (const rule of rawRules.split(',')) {
      const [rawPattern, rawWeight] = rule.split(':');
      const pattern = rawPattern?.trim().toLowerCase();
      const parsedWeight = Number(rawWeight);
      if (!pattern || !Number.isFinite(parsedWeight)) {
        continue;
      }
      if (haystack.includes(pattern)) {
        weight = this.clampSourceAuthorityWeight(parsedWeight);
      }
    }
    return weight;
  }

  private clampSourceAuthorityWeight(weight: number): number {
    return Math.min(Math.max(weight, 0.5), 2);
  }

  filterActiveVectorHits(
    chunkMeta: ReadonlyMap<string, Omit<IndexedChunk, 'id'>>,
    hits: Awaited<ReturnType<VectorStoreProvider['similaritySearch']>>,
    userId?: string,
    allowedDocIds?: ReadonlySet<string>,
    scope?: RetrievalScope,
  ): Awaited<ReturnType<VectorStoreProvider['similaritySearch']>> {
    return hits.flatMap((hit) => {
      const sourceChunk = chunkMeta.get(hit.id);
      if (sourceChunk == null) return [];
      if (allowedDocIds != null) {
        if (allowedDocIds.has(sourceChunk.docId) === false) return [];
      } else if (sourceChunk.userId !== userId) {
        return [];
      }
      if (!this.isLifecycleVisible(sourceChunk, scope)) return [];
      return [
        {
          ...hit,
          content: sourceChunk.content,
          docId: sourceChunk.docId,
          chunkIndex: sourceChunk.chunkIndex,
        },
      ];
    });
  }

  async applyRerank(
    query: string,
    chunks: RetrievedChunk[],
    signal?: AbortSignal,
  ): Promise<{ chunks: RetrievedChunk[]; applied: boolean }> {
    if (
      chunks.length < 2 ||
      !this.isRerankEnabled() ||
      !this.rerankService ||
      !this.rerankService.isEnabled()
    ) {
      return { chunks, applied: false };
    }
    const topN = this.intConfig('RAG_RERANK_TOP_N', 20, 1, 50);
    const candidates = chunks.slice(0, topN);
    if (candidates.length < 2) {
      return { chunks, applied: false };
    }
    try {
      const reranked = signal
        ? await this.rerankService.rerank(query, candidates, topN, signal)
        : await this.rerankService.rerank(query, candidates, topN);
      // rerank 服务短路（未真正调用远端）时会原样返回同一数组，视为未生效
      if (reranked === candidates || reranked.length === 0) {
        return { chunks, applied: false };
      }
      const rerankScoreById = new Map(
        reranked.map((chunk) => [chunk.id, chunk.totalScore]),
      );
      const orderById = new Map(
        reranked.map((chunk, index) => [chunk.id, index]),
      );
      const rerankedHead = candidates
        .map((chunk) => {
          const rerankScore = rerankScoreById.get(chunk.id);
          return rerankScore === undefined ? chunk : { ...chunk, rerankScore };
        })
        .sort(
          (a, b) =>
            (orderById.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (orderById.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        );
      return {
        chunks: [...rerankedHead, ...chunks.slice(topN)],
        applied: true,
      };
    } catch (err) {
      this.logger.warn(
        `DashScope rerank failed, keep original order: ${(err as Error).message}`,
      );
      return { chunks, applied: false };
    }
  }

  private isRerankEnabled(): boolean {
    return this.configService.get<string>('RAG_RERANK_ENABLED') !== 'false';
  }

  private intConfig(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const raw = this.configService.get<string | number>(key);
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
  }

  matchesScope(
    chunk: Partial<RetrievedChunk>,
    scope: RetrievalScope = {},
  ): boolean {
    if (
      !(scope.includeDeprecated ?? Boolean(scope.effectiveTime)) &&
      chunk.lifecycleStatus === 'deprecated'
    ) {
      return false;
    }
    const exactFields: Array<
      keyof Pick<
        RetrievalScope,
        | 'projectId'
        | 'activityId'
        | 'region'
        | 'locale'
        | 'channel'
        | 'documentType'
      >
    > = [
      'projectId',
      'activityId',
      'region',
      'locale',
      'channel',
      'documentType',
    ];
    for (const field of exactFields) {
      const expected = scope[field]?.trim().toLowerCase();
      if (!expected) continue;
      const actual = String(chunk[field] ?? '')
        .trim()
        .toLowerCase();
      if (actual !== expected) return false;
    }
    if (scope.role) {
      const expectedRole = canonicalizeRole(scope.role);
      const roles = (chunk.roleScope ?? []).map(canonicalizeRole);
      if (roles.length > 0 && !roles.includes(expectedRole)) return false;
    }
    return true;
  }

  isLifecycleVisible(
    chunk: Partial<RetrievedChunk>,
    scope?: RetrievalScope,
  ): boolean {
    return isEffectiveDuring(chunk, scope?.effectiveTime);
  }

  expandContextChunks(
    sourceEntries: readonly IndexedChunk[],
    hits: RetrievedChunk[],
    profile: RetrievalProfile,
    userId?: string,
    scope?: RetrievalScope,
    allowedDocIds?: ReadonlySet<string>,
  ): RetrievedChunk[] {
    if (profile.neighborWindow === 0 && profile.sameSectionLimit === 0) {
      return hits;
    }

    const entries = sourceEntries.filter(
      (entry) =>
        (allowedDocIds != null
          ? allowedDocIds.has(entry.docId)
          : entry.userId === userId) &&
        this.matchesScope(entry, scope) &&
        this.isLifecycleVisible(entry, scope),
    );
    const expanded: RetrievedChunk[] = [];
    const seen = new Set<string>();
    const add = (chunk: RetrievedChunk) => {
      if (!seen.has(chunk.id)) {
        seen.add(chunk.id);
        expanded.push(chunk);
      }
    };

    for (const hit of hits) {
      add(hit);
      const sameDocument = entries.filter((entry) => entry.docId === hit.docId);
      for (const entry of sameDocument) {
        const distance = Math.abs(entry.chunkIndex - hit.chunkIndex);
        if (distance > 0 && distance <= profile.neighborWindow) {
          add(this.toExpandedChunk(entry, hit.totalScore * 0.85, 'neighbor'));
        }
      }
      if (hit.sectionId && profile.sameSectionLimit > 0) {
        sameDocument
          .filter(
            (entry) => entry.id !== hit.id && entry.sectionId === hit.sectionId,
          )
          .sort(
            (a, b) =>
              Math.abs(a.chunkIndex - hit.chunkIndex) -
              Math.abs(b.chunkIndex - hit.chunkIndex),
          )
          .slice(0, profile.sameSectionLimit)
          .forEach((entry) =>
            add(this.toExpandedChunk(entry, hit.totalScore * 0.8, 'section')),
          );
      }
    }
    return expanded;
  }

  private toExpandedChunk(
    entry: IndexedChunk,
    score: number,
    contextRole: 'neighbor' | 'section',
  ): RetrievedChunk {
    return {
      id: entry.id,
      content: entry.content,
      docId: entry.docId,
      chunkIndex: entry.chunkIndex,
      ...this.pickChunkMetadata(entry),
      bm25Score: 0,
      cosineScore: 0,
      totalScore: score,
      retrievalSource: 'expansion',
      contextRole,
    };
  }
}
