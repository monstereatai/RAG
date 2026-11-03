import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import type { RetrievedChunk } from '../evidence/retrieval.types';
import type { IndexedChunk } from './retrieval-postprocessor';

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
    return !scope.userId || row.userId === scope.userId;
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
