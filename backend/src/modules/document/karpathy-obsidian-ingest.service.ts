import { Injectable } from '@nestjs/common';
import {
  ObsidianKnowledgeService,
  ObsidianWriteResult,
} from '../obsidian/obsidian-knowledge.service';
import { UrlExtractionResult } from './document-parser.util';
import { DocumentService, UploadResult } from './document.service';

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
    filename: string;
  }): Promise<KarpathyObsidianIngestResult> {
    const content = params.extracted.content.trim();
    const title = this.normalizeTitle(
      params.extracted.title ||
        this.extractTitleFromMarkdown(content) ||
        params.url,
    );
    const duplicate = await this.obsidianKnowledge.findSourceByContentHash(
      content,
    );
    if (duplicate?.ragDocId) {
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
            originalBuffer: params.extracted.snapshot,
            contentType: params.extracted.contentType || 'text/plain',
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
        originalBuffer: params.extracted.snapshot,
        contentType: params.extracted.contentType || 'text/plain',
      },
    );

    const obsidian = await this.obsidianKnowledge.writeSource({
      title,
      sourceUrl: params.extracted.finalUrl || params.url,
      content,
      ragDocId: rag.docId,
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
    filename: string;
    sourceUrl?: string;
    sourceType: 'document' | 'official-docs' | 'manual';
    contentType?: string;
    originalBuffer?: Buffer;
    taskId?: string;
  }): Promise<KarpathyObsidianIngestResult> {
    const duplicate = await this.obsidianKnowledge.findSourceByContentHash(
      params.content,
    );
    if (duplicate?.ragDocId) {
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
            originalBuffer:
              params.originalBuffer ?? Buffer.from(params.content, 'utf8'),
            contentType: params.contentType ?? 'text/markdown',
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
        originalBuffer:
          params.originalBuffer ?? Buffer.from(params.content, 'utf8'),
        contentType: params.contentType ?? 'text/markdown',
      },
    );

    const obsidian = await this.obsidianKnowledge.writeSource({
      title: params.title,
      sourceUrl: params.sourceUrl,
      content: params.content,
      ragDocId: rag.docId,
      sourceType: params.sourceType,
      contentType: params.contentType,
      filename: params.filename,
    });

    return { rag, obsidian };
  }

  private extractTitleFromMarkdown(content: string): string | null {
    return /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? null;
  }

  private normalizeTitle(title: string): string {
    return title.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
  }
}
