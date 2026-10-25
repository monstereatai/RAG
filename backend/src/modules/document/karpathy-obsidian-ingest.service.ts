import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import type { Repository } from 'typeorm';
import {
  ObsidianKnowledgeService,
  ObsidianWriteResult,
} from '../obsidian/obsidian-knowledge.service';
import { UrlExtractionResult } from './document-parser.util';
import { DocumentService, UploadResult } from './document.service';
import type { DocumentBusinessMetadata } from './document-profile.util';
import { DocumentQueueService } from './document-queue.service';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';

export type KarpathyObsidianWriteStatus =
  | ObsidianWriteResult['status']
  | 'queued'
  | 'skipped';

export interface KarpathyObsidianWriteResult extends Omit<
  ObsidianWriteResult,
  'status'
> {
  status: KarpathyObsidianWriteStatus;
  taskId?: string;
}

export interface KarpathyObsidianIngestResult {
  rag: UploadResult;
  obsidian: KarpathyObsidianWriteResult;
}

@Injectable()
export class KarpathyObsidianIngestService {
  private readonly logger = new Logger(KarpathyObsidianIngestService.name);

  constructor(
    private readonly documentService: DocumentService,
    private readonly obsidianKnowledge: ObsidianKnowledgeService,
    private readonly documentQueue: DocumentQueueService,
    @InjectRepository(DocumentChunkEntity)
    private readonly documentChunkRepo: Repository<DocumentChunkEntity>,
  ) {
    this.documentQueue.registerObsidianNoteProcessor(async (job) => {
      const chunks = await this.documentChunkRepo.find({
        where: { docId: job.docId, userId: job.userId },
        order: { chunkIndex: 'ASC' },
      });
      if (chunks.length === 0) {
        this.logger.warn(
          `Skipping Obsidian note task because source chunks are unavailable: doc=${job.docId}`,
        );
        return;
      }
      const result = await this.obsidianKnowledge.writeSource({
        userId: job.userId,
        title: job.title,
        sourceUrl: job.sourceUrl,
        content: this.rebuildContentFromChunks(chunks),
        contentHash: job.contentHash,
        ragDocId: job.docId,
        sourceType: job.sourceType,
        contentType: job.contentType,
        filename: job.filename,
      });
      if (result.status === 'failed') {
        throw new Error(result.error || 'Obsidian note write failed');
      }
    });
  }

  async ingestUrl(params: {
    url: string;
    extracted: UrlExtractionResult;
    userId: string;
    tenantId?: string;
    filename: string;
    businessMetadata?: DocumentBusinessMetadata;
  }): Promise<KarpathyObsidianIngestResult> {
    const content = params.extracted.content.trim();
    const title = this.normalizeTitle(
      params.extracted.title ||
        this.extractTitleFromMarkdown(content) ||
        params.url,
    );
    const duplicate = await this.findDuplicate(content, params.userId);
    if (
      duplicate?.ragDocId &&
      !this.hasBusinessMetadata(params.businessMetadata)
    ) {
      const hasCurrentRagDoc = await this.documentService.hasDoc(
        duplicate.ragDocId,
        params.userId,
      );
      if (!hasCurrentRagDoc) {
        const rag = await this.documentService.upload(
          params.filename,
          content,
          params.userId,
          {
            tenantId: params.tenantId,
            originalBuffer: params.extracted.snapshot,
            contentType: params.extracted.contentType || 'text/plain',
            businessMetadata: params.businessMetadata,
          },
        );
        return {
          rag,
          obsidian: {
            status: 'duplicate',
            notePath: duplicate.notePath,
            title: duplicate.title,
            tags: duplicate.tags,
            contentHash: duplicate.contentHash,
            ragDocId: rag.docId,
          },
        };
      }

      return {
        rag: {
          docId: duplicate.ragDocId,
          chunkCount: 0,
        },
        obsidian: {
          status: 'duplicate',
          notePath: duplicate.notePath,
          title: duplicate.title,
          tags: duplicate.tags,
          contentHash: duplicate.contentHash,
          ragDocId: duplicate.ragDocId,
        },
      };
    }

    const rag = await this.documentService.upload(
      params.filename,
      content,
      params.userId,
      {
        tenantId: params.tenantId,
        originalBuffer: params.extracted.snapshot,
        contentType: params.extracted.contentType || 'text/plain',
        businessMetadata: params.businessMetadata,
      },
    );
    const obsidian = await this.enqueueNote({
      docId: rag.docId,
      userId: params.userId,
      title,
      sourceUrl: params.extracted.finalUrl || params.url,
      content,
      sourceType: 'url',
      contentType: params.extracted.contentType || 'text/plain',
      filename: params.filename,
    });

    return { rag, obsidian };
  }

  async ingestText(params: {
    title: string;
    content: string;
    userId: string;
    tenantId?: string;
    trustedAdminPrincipal?: boolean;
    filename: string;
    sourceUrl?: string;
    sourceType: 'document' | 'official-docs' | 'manual';
    contentType?: string;
    originalBuffer?: Buffer;
    taskId?: string;
    businessMetadata?: DocumentBusinessMetadata;
    docId?: string;
    incrementalUpdate?: boolean;
  }): Promise<KarpathyObsidianIngestResult> {
    // 文本已由入口完成解析；这里处理内容去重，并把 RAG 文档索引与 Obsidian 来源记录关联起来。
    const duplicate = await this.findDuplicate(params.content, params.userId);
    if (
      duplicate?.ragDocId &&
      !this.hasBusinessMetadata(params.businessMetadata)
    ) {
      const hasCurrentRagDoc = await this.documentService.hasDoc(
        duplicate.ragDocId,
        params.userId,
      );
      if (!hasCurrentRagDoc) {
        const rag = await this.documentService.upload(
          params.filename,
          params.content,
          params.userId,
          {
            taskId: params.taskId,
            tenantId: params.tenantId,
            trustedAdminPrincipal: params.trustedAdminPrincipal,
            docId: params.docId,
            incrementalUpdate: params.incrementalUpdate,
            originalBuffer:
              params.originalBuffer ?? Buffer.from(params.content, 'utf8'),
            contentType: params.contentType ?? 'text/markdown',
            businessMetadata: params.businessMetadata,
          },
        );
        return {
          rag,
          obsidian: {
            status: 'duplicate',
            notePath: duplicate.notePath,
            title: duplicate.title,
            tags: duplicate.tags,
            contentHash: duplicate.contentHash,
            ragDocId: rag.docId,
          },
        };
      }

      return {
        rag: {
          docId: duplicate.ragDocId,
          chunkCount: 0,
          taskId: params.taskId,
        },
        obsidian: {
          status: 'duplicate',
          notePath: duplicate.notePath,
          title: duplicate.title,
          tags: duplicate.tags,
          contentHash: duplicate.contentHash,
          ragDocId: duplicate.ragDocId,
        },
      };
    }

    const rag = await this.documentService.upload(
      params.filename,
      params.content,
      params.userId,
      {
        taskId: params.taskId,
        tenantId: params.tenantId,
        trustedAdminPrincipal: params.trustedAdminPrincipal,
        docId: params.docId,
        incrementalUpdate: params.incrementalUpdate,
        originalBuffer:
          params.originalBuffer ?? Buffer.from(params.content, 'utf8'),
        contentType: params.contentType ?? 'text/markdown',
        businessMetadata: params.businessMetadata,
      },
    );
    const obsidian = await this.enqueueNote({
      docId: rag.docId,
      userId: params.userId,
      title: params.title,
      sourceUrl: params.sourceUrl,
      content: params.content,
      sourceType: params.sourceType,
      contentType: params.contentType,
      filename: params.filename,
    });

    return { rag, obsidian };
  }

  private async findDuplicate(content: string, userId: string) {
    try {
      return await this.obsidianKnowledge.findSourceByContentHash(content, {
        userId,
      });
    } catch (error) {
      this.logger.warn(
        `Obsidian duplicate lookup failed; continuing RAG ingest: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async enqueueNote(input: {
    docId: string;
    userId: string;
    title: string;
    sourceUrl?: string;
    content: string;
    sourceType: 'url' | 'document' | 'official-docs' | 'manual';
    contentType?: string;
    filename?: string;
  }): Promise<KarpathyObsidianWriteResult> {
    const queued = await this.documentQueue.enqueueObsidianNote({
      docId: input.docId,
      userId: input.userId,
      title: input.title,
      contentHash: createHash('sha256')
        .update(input.content.trim())
        .digest('hex'),
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
      contentType: input.contentType,
      filename: input.filename,
    });
    return {
      status: queued.status,
      ...(queued.taskId ? { taskId: queued.taskId } : {}),
      ...(queued.reason ? { error: queued.reason } : {}),
      title: input.title,
      tags: [],
      contentHash: createHash('sha256').update(input.content).digest('hex'),
      ragDocId: input.docId,
    };
  }

  private rebuildContentFromChunks(chunks: DocumentChunkEntity[]): string {
    let content = '';
    let previousSection = '';
    let previousChunk = '';

    for (const chunk of chunks) {
      const next = chunk.content.trim();
      if (!next) continue;
      const section = `${chunk.sectionId ?? ''}:${chunk.sourceStart ?? ''}:${chunk.sourceEnd ?? ''}`;
      if (!content) {
        content = next;
      } else if (section !== previousSection) {
        content += `\n\n${next}`;
      } else {
        const overlap = this.findChunkOverlap(previousChunk, next);
        content += overlap > 0 ? next.slice(overlap) : `\n${next}`;
      }
      previousSection = section;
      previousChunk = next;
    }

    return content;
  }

  private findChunkOverlap(current: string, next: string): number {
    const maxOverlap = Math.min(current.length, next.length, 4096);
    if (maxOverlap === 0) return 0;

    const prefix = new Array<number>(maxOverlap).fill(0);
    for (let index = 1, length = 0; index < maxOverlap; index += 1) {
      while (length > 0 && next[index] !== next[length]) {
        length = prefix[length - 1];
      }
      if (next[index] === next[length]) length += 1;
      prefix[index] = length;
    }

    let matched = 0;
    const suffix = current.slice(-maxOverlap);
    for (let index = 0; index < suffix.length; index += 1) {
      const char = suffix[index];
      while (matched > 0 && char !== next[matched]) {
        matched = prefix[matched - 1];
      }
      if (char === next[matched]) matched += 1;
      if (matched === maxOverlap && index < suffix.length - 1) {
        matched = prefix[matched - 1];
      }
    }
    return matched;
  }

  private hasBusinessMetadata(metadata?: DocumentBusinessMetadata): boolean {
    return Boolean(
      metadata &&
      Object.values(metadata).some((value) =>
        Array.isArray(value) ? value.length > 0 : Boolean(value),
      ),
    );
  }

  private extractTitleFromMarkdown(content: string): string | null {
    return /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? null;
  }

  private normalizeTitle(title: string): string {
    return title.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
  }
}
