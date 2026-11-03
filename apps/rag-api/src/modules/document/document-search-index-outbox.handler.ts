import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { AuthoritativeChunkService } from '../../rag/retrieval/authoritative-chunk.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { DocumentIndexCoordinator } from './document-index-coordinator.service';
import { DOCUMENT_SEARCH_INDEX_UPSERT_EVENT } from './document-search-index.events';

@Injectable()
export class DocumentSearchIndexOutboxHandler implements OnModuleInit {
  constructor(
    private readonly domainEvents: DomainEventsService,
    private readonly authoritativeChunks: AuthoritativeChunkService,
    private readonly indexCoordinator: DocumentIndexCoordinator,
    @InjectRepository(DocumentMetaEntity)
    private readonly documents: Repository<DocumentMetaEntity>,
    @InjectRepository(DocumentChunkEntity)
    private readonly chunks: Repository<DocumentChunkEntity>,
  ) {}

  onModuleInit(): void {
    this.domainEvents.registerInternalHandler(
      DOCUMENT_SEARCH_INDEX_UPSERT_EVENT,
      async (event) => {
        const payload = this.parsePayload(event.payload);
        await this.rebuild(event.aggregateId, event.tenantId, payload);
      },
    );
  }

  private async rebuild(
    docId: string,
    tenantId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const document = await this.documents.findOne({ where: { docId } });
    if (!document) return;
    const requestedGeneration = this.stringValue(payload.indexGeneration);
    if (
      requestedGeneration &&
      document.indexGeneration &&
      requestedGeneration !== document.indexGeneration
    ) {
      return;
    }
    const userId = document.userId ?? this.stringValue(payload.userId);
    if (!userId) {
      throw new Error(`document search index is missing userId: ${docId}`);
    }
    const rows = await this.chunks.find({
      where: { docId, userId, chunkType: 'leaf' },
      order: { chunkIndex: 'ASC' },
    });
    const indexedChunks = rows.map((row) => ({
      ...this.authoritativeChunks.toIndexedChunk(row),
      effectiveAt: row.effectiveAt,
      expiredAt: row.expiredAt,
    }));
    await this.indexCoordinator.rebuildDocumentSearchIndexes({
      chunks: indexedChunks,
      userId,
      document: {
        docId,
        filename: document.filename,
        content: indexedChunks.map((chunk) => chunk.content).join('\n\n'),
        userId,
        tenantId: document.tenantId ?? tenantId ?? 'legacy',
        title: document.title,
        summary: document.summary,
        sourceAuthority: document.sourceAuthority,
        projectId: document.projectId,
        activityId: document.activityId,
        region: document.region,
        locale: document.locale,
        channel: document.channel,
        roleScope: this.parseStringArray(document.roleScope),
        documentType: document.documentType,
        lifecycleStatus: document.lifecycleStatus,
        docVersion: document.docVersion,
        contentHash: document.contentHash,
        indexGeneration: document.indexGeneration,
        changeType: document.changeType,
        effectiveAt: document.effectiveAt,
        expiredAt: document.expiredAt,
      },
    });
  }

  private parsePayload(payload: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(payload) as unknown;
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private parseStringArray(value: string | null): string[] {
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

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
  }
}
