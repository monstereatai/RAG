import { Injectable } from '@nestjs/common';
import {
  ObsidianKnowledgeService,
  ObsidianWriteResult,
} from '../obsidian/obsidian-knowledge.service';
import { UrlExtractionResult } from './document-parser.util';
import { DocumentService, UploadResult } from './document.service';
import type { DocumentBusinessMetadata } from './document-profile.util';

export interface KarpathyObsidianIngestResult {
  rag: UploadResult;
  obsidian: ObsidianWriteResult;
}

@Injectable()
export class KarpathyObsidianIngestService {
  constructor(
    private readonly documentService: DocumentService,
    private readonly obsidianKnowledge: ObsidianKnowledgeService,
  ) {}

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
    const duplicate = await this.obsidianKnowledge.findSourceByContentHash(
      content,
      {
        userId: params.userId,
      },
    );
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

    let obsidian: ObsidianWriteResult | null = null;
    const rag = await this.documentService.upload(
      params.filename,
      content,
      params.userId,
      {
        tenantId: params.tenantId,
        originalBuffer: params.extracted.snapshot,
        contentType: params.extracted.contentType || 'text/plain',
        businessMetadata: params.businessMetadata,
        onQualityAccepted: async (docId) => {
          obsidian = await this.obsidianKnowledge.writeSource({
            userId: params.userId,
            title,
            sourceUrl: params.extracted.finalUrl || params.url,
            content,
            ragDocId: docId,
            sourceType: 'url',
            contentType: params.extracted.contentType || 'text/plain',
            filename: params.filename,
          });
        },
      },
    );
    if (!obsidian) throw new Error('Obsidian source write did not complete');

    return { rag, obsidian };
  }

  async ingestText(params: {
    title: string;
    content: string;
    userId: string;
    tenantId?: string;
    filename: string;
    sourceUrl?: string;
    sourceType: 'document' | 'official-docs' | 'manual';
    contentType?: string;
    originalBuffer?: Buffer;
    taskId?: string;
    businessMetadata?: DocumentBusinessMetadata;
  }): Promise<KarpathyObsidianIngestResult> {
    const duplicate = await this.obsidianKnowledge.findSourceByContentHash(
      params.content,
      { userId: params.userId },
    );
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

    let obsidian: ObsidianWriteResult | null = null;
    const rag = await this.documentService.upload(
      params.filename,
      params.content,
      params.userId,
      {
        taskId: params.taskId,
        tenantId: params.tenantId,
        originalBuffer:
          params.originalBuffer ?? Buffer.from(params.content, 'utf8'),
        contentType: params.contentType ?? 'text/markdown',
        businessMetadata: params.businessMetadata,
        onQualityAccepted: async (docId) => {
          obsidian = await this.obsidianKnowledge.writeSource({
            userId: params.userId,
            title: params.title,
            sourceUrl: params.sourceUrl,
            content: params.content,
            ragDocId: docId,
            sourceType: params.sourceType,
            contentType: params.contentType,
            filename: params.filename,
          });
        },
      },
    );
    if (!obsidian) throw new Error('Obsidian source write did not complete');

    return { rag, obsidian };
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
