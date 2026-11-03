import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import type { RetrievedChunk } from '../evidence/retrieval.types';
import type { IndexedChunk } from './retrieval-postprocessor';
import type { Bm25PersistedEntry } from '../indexing/bm25-store';
import type { RetrievalScope } from '../evidence/retrieval.types';
import { isEffectiveDuring } from './effective-time';
import { canonicalizeRole } from '../../modules/chat/role-presets';

export interface AuthoritativeChunkScope {
  tenantId?: string;
  userId?: string;
  allowedDocIds?: ReadonlySet<string>;
}

@Injectable()
export class AuthoritativeChunkService {
  constructor(
    @InjectRepository(DocumentChunkEntity)
    private readonly chunks: Repository<DocumentChunkEntity>,
  ) {}

  async hydrateCandidates(
    candidates: readonly RetrievedChunk[],
    scope: AuthoritativeChunkScope,
  ): Promise<RetrievedChunk[]> {
    if (candidates.length === 0) return [];
    const uniqueIds = [...new Set(candidates.map((candidate) => candidate.id))];
    const rows = await this.chunks.find({
      where: { id: In(uniqueIds), chunkType: 'leaf' },
    });
    const byId = new Map(
      rows
        .filter((row) => this.isVisible(row, scope))
        .map((row) => [row.id, row]),
    );
    const parentContents = await this.loadParentContents(
      [...byId.values()],
      scope,
    );

    return candidates.flatMap((candidate) => {
      const row = byId.get(candidate.id);
      if (!row) return [];
      return [
        {
          ...candidate,
          ...this.toIndexedChunk(row, parentContents.get(row.id)),
        },
      ];
    });
  }

  async loadContextChunks(
    docIds: readonly string[],
    scope: AuthoritativeChunkScope,
  ): Promise<IndexedChunk[]> {
    const uniqueDocIds = [...new Set(docIds.filter(Boolean))];
    if (uniqueDocIds.length === 0) return [];
    const rows = await this.chunks.find({
      where: { docId: In(uniqueDocIds), chunkType: 'leaf' },
      order: { docId: 'ASC', chunkIndex: 'ASC' },
    });
    const visibleRows = rows.filter((row) => this.isVisible(row, scope));
    const parentContents = await this.loadParentContents(visibleRows, scope);
    return visibleRows.map((row) =>
      this.toIndexedChunk(row, parentContents.get(row.id)),
    );
  }

  /** Description hits are linked to source chunk IDs, never to process-local BM25 state. */
  async loadDescriptionSourceEntries(
    chunkIds: readonly string[],
    scope: AuthoritativeChunkScope,
  ): Promise<Bm25PersistedEntry[]> {
    const ids = [...new Set(chunkIds.filter(Boolean))].slice(0, 1500);
    if (ids.length === 0 || (!scope.userId && !scope.allowedDocIds)) return [];
    const rows = await this.chunks.find({
      where: { id: In(ids), chunkType: 'leaf' },
    });
    return rows.filter((row) => this.isVisible(row, scope)).map((row) => ({
      ...this.toIndexedChunk(row),
      tokens: [],
      userId: row.userId ?? undefined,
      indexGeneration: row.indexGeneration,
      hypotheticalQuestions: this.parseStringArray(row.hypotheticalQuestions),
    }));
  }

  /** Bound, batch-checked evidence visibility for graph and image supplements. */
  async loadVisibleEvidenceDocIds(
    docIds: readonly string[],
    auth: AuthoritativeChunkScope,
    scope?: RetrievalScope,
  ): Promise<Set<string>> {
    const ids = [...new Set(docIds.filter(Boolean))].slice(0, 100);
    if (ids.length === 0 || (!auth.userId && !auth.allowedDocIds)) return new Set();
    const rows = await this.chunks.find({
      where: { docId: In(ids), chunkType: 'leaf' },
      select: {
        docId: true, tenantId: true, userId: true,
        effectiveAt: true, expiredAt: true, lifecycleStatus: true,
        projectId: true, activityId: true, region: true,
        locale: true, channel: true, documentType: true, roleScope: true,
      },
    });
    const visible = new Set<string>();
    for (const row of rows) {
      if (!this.isVisible(row, auth)) continue;
      const lifecycle = {
        lifecycleStatus: row.lifecycleStatus,
        effectiveAt: row.effectiveAt?.toISOString() ?? null,
        expiredAt: row.expiredAt?.toISOString() ?? null,
      };
      if (!isEffectiveDuring(lifecycle, scope?.effectiveTime)) continue;
      if (!(scope?.includeDeprecated ?? Boolean(scope?.effectiveTime)) && row.lifecycleStatus === 'deprecated') continue;
      const fields = ['projectId', 'activityId', 'region', 'locale', 'channel', 'documentType'] as const;
      if (fields.some((field) => scope?.[field] &&
        String(row[field] ?? '').trim().toLowerCase() !== scope[field]?.trim().toLowerCase())) continue;
      if (scope?.role) {
        const roles = this.parseStringArray(row.roleScope).map(canonicalizeRole);
        if (roles.length > 0 && !roles.includes(canonicalizeRole(scope.role))) continue;
      }
      visible.add(row.docId);
    }
    return visible;
  }

  private async loadParentContents(
    leaves: readonly DocumentChunkEntity[],
    scope: AuthoritativeChunkScope,
  ): Promise<Map<string, string | null>> {
    const parentIds = [
      ...new Set(
        leaves.flatMap((leaf) =>
          leaf.parentChunkId ? [leaf.parentChunkId] : [],
        ),
      ),
    ];
    if (parentIds.length === 0) return new Map();
    const parents = await this.chunks.find({
      where: { id: In(parentIds), chunkType: 'parent' },
    });
    const visibleParents = new Map(
      parents
        .filter((parent) => this.isVisible(parent, scope))
        .map((parent) => [parent.id, parent]),
    );
    return new Map(
      leaves.map((leaf) => {
        const parent = leaf.parentChunkId
          ? visibleParents.get(leaf.parentChunkId)
          : undefined;
        const sameScope =
          parent !== undefined &&
          parent.docId === leaf.docId &&
          parent.tenantId === leaf.tenantId &&
          parent.userId === leaf.userId;
        return [leaf.id, sameScope ? parent.content : leaf.parentContent];
      }),
    );
  }

  private isVisible(
    row: DocumentChunkEntity,
    scope: AuthoritativeChunkScope,
  ): boolean {
    if (scope.tenantId && row.tenantId !== scope.tenantId) return false;
    if (scope.allowedDocIds) return scope.allowedDocIds.has(row.docId);
    return Boolean(scope.userId && row.userId === scope.userId);
  }

  toIndexedChunk(
    row: DocumentChunkEntity,
    parentContent: string | null = row.parentContent,
  ): IndexedChunk {
    return {
      id: row.id,
      content: row.content,
      docId: row.docId,
      chunkIndex: row.chunkIndex,
      userId: row.userId ?? undefined,
      parentChunkId: row.parentChunkId,
      headingPath: this.parseStringArray(row.headingPath),
      sectionId: row.sectionId,
      clauseId: row.clauseId,
      tableRef: row.tableRef,
      sourceStart: row.sourceStart,
      sourceEnd: row.sourceEnd,
      parentContent,
      sourceMetadata: row.sourceMetadata,
      docVersion: row.docVersion,
      effectiveAt: row.effectiveAt?.toISOString() ?? null,
      expiredAt: row.expiredAt?.toISOString() ?? null,
      sourceAuthority: row.sourceAuthority,
      projectId: row.projectId,
      activityId: row.activityId,
      region: row.region,
      locale: row.locale,
      channel: row.channel,
      roleScope: this.parseStringArray(row.roleScope),
      documentType: row.documentType,
      lifecycleStatus: row.lifecycleStatus,
      supersedesDocId: row.supersedesDocId,
      ruleKey: row.ruleKey,
      changeType: row.changeType,
      supersedesChunkId: row.supersedesChunkId,
    };
  }

  private parseStringArray(value: string | null | undefined): string[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  }
}
