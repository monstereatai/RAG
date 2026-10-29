import { Injectable } from '@nestjs/common';
import {
  ObsidianKnowledgeService,
  type ObsidianSearchHit,
} from '../../modules/obsidian/obsidian-knowledge.service';
import { DocumentPermissionService } from '../../modules/document/document-permission.service';
import type { RetrievedChunk } from '../evidence/retrieval.types';
import type { RetrieveOptions } from '../contracts/rag-types';
import { BM25 } from '../indexing/bm25.util';
import type { Bm25PersistedEntry } from '../indexing/bm25-store';
import { RagIndexService } from '../indexing/rag-index.service';
import { RagRetrievalService } from '../retrieval/rag-retrieval.service';
import { retrievalProfileForTaskType } from '../retrieval/context-builder';

@Injectable()
export class RagObsidianService {
  private readonly bm25Weight = 0.3;

  private get persistedEntries(): readonly Bm25PersistedEntry[] {
    return this.indexService.getPersistedEntries();
  }

  constructor(
    private readonly obsidianKnowledge: ObsidianKnowledgeService,
    private readonly documentPermissionService: DocumentPermissionService,
    private readonly indexService: RagIndexService,
    private readonly retrievalService: RagRetrievalService,
  ) {}

  async getObsidianContext(
    query: string,
    userId?: string,
    role?: string,
  ): Promise<{
    hits: ObsidianSearchHit[];
    context: string;
  }> {
    const hits = await this.obsidianKnowledge.search(
      this.retrievalService.normalizeQuery(query),
      5,
      {
        userId,
        roles: role ? [role] : [],
      },
    );
    return {
      hits,
      context: this.obsidianKnowledge.formatHitsForPrompt(hits),
    };
  }

  /** 已由 Fast Path 查询到的 Obsidian 命中只格式化，不得再次读取。 */
  formatObsidianContext(hits: ObsidianSearchHit[]): string {
    return this.obsidianKnowledge.formatHitsForPrompt(hits);
  }

  toObsidianChunks(hits: ObsidianSearchHit[]): RetrievedChunk[] {
    return hits.map((hit, index) => ({
      id: `obsidian:${hit.path}`,
      content: [
        hit.title,
        `path: ${hit.path}`,
        hit.sourceUrl ? `source: ${hit.sourceUrl}` : '',
        hit.content,
      ]
        .filter(Boolean)
        .join('\n'),
      docId: hit.ragDocId ?? hit.path,
      chunkIndex: index,
      bm25Score: 0,
      cosineScore: 0,
      totalScore: hit.score,
      sourceAuthority: 'obsidian',
      headingPath: [hit.type, hit.title],
      retrievalSource: 'obsidian',
      contextRole: 'obsidian',
    }));
  }

  /** Obsidian source note 只定位原文；回答证据始终来自已索引的原始 chunk。 */
  async resolveObsidianSourceEvidence(
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
    const sourceNoteHits = hits.filter(
      (hit) => hit.isSourceNote || (hit.type === 'note' && hit.ragDocId),
    );
    const sourceNotePaths = new Set(sourceNoteHits.map((hit) => hit.path));
    const mappedDocIds = new Set(
      sourceNoteHits.flatMap((hit) => (hit.ragDocId ? [hit.ragDocId] : [])),
    );
    if (mappedDocIds.size === 0) {
      return { chunks: [], mappedDocIds, sourceNotePaths };
    }

    const allowedDocIds = userId
      ? await this.documentPermissionService.getAllowedDocIds(
          userId,
          options.roles ?? [],
          options.departmentIds ?? [],
          options.tenantId,
          options.trustedAdminPrincipal,
        )
      : null;
    const eligibleEntries = new Map<string, Bm25PersistedEntry>();
    for (const entry of this.persistedEntries) {
      if (
        !mappedDocIds.has(entry.docId) ||
        (allowedDocIds
          ? !allowedDocIds.has(entry.docId)
          : entry.userId !== userId) ||
        !this.retrievalService.isLifecycleVisible(entry, options.scope) ||
        !this.retrievalService.matchesScope(entry, options.scope)
      ) {
        continue;
      }
      eligibleEntries.set(entry.id, entry);
    }
    if (eligibleEntries.size === 0) {
      return { chunks: [], mappedDocIds, sourceNotePaths };
    }

    const normalizedQuery = this.retrievalService.normalizeQuery(query);
    const bm25 = new BM25();
    bm25.addDocs(
      [...eligibleEntries.values()].map((entry) => ({
        id: entry.id,
        content: entry.content,
        searchText: `${entry.content}\n${(entry.hypotheticalQuestions ?? []).join('\n')}`,
      })),
    );
    const profile = retrievalProfileForTaskType('lookup');
    const ranked = bm25.search(normalizedQuery, profile.candidateDepth);
    const maxScore = Math.max(...ranked.map((hit) => hit.score), 1);
    const chunks = ranked.flatMap((hit, index) => {
      const entry = eligibleEntries.get(hit.id);
      if (!entry) return [];
      return [
        this.retrievalService.applySourceAuthorityToChunk({
          id: entry.id,
          content: entry.content,
          docId: entry.docId,
          chunkIndex: entry.chunkIndex,
          ...this.retrievalService.pickChunkMetadata(entry),
          bm25Score: hit.score / maxScore,
          cosineScore: 0,
          totalScore: this.retrievalService.rankScore(index) * this.bm25Weight,
          retrievalSource: 'bm25',
          contextRole: 'hit',
        }),
      ];
    });
    return { chunks, mappedDocIds, sourceNotePaths };
  }
}
