import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { ObjectStorageProvider } from '../../providers/object-storage/object-storage.provider';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { ImageIndexService, type ImageIndexInput } from '../image-index/image-index.service';
import {
  detectDocumentKind,
  type DocumentImageExtractionOptions,
} from './document-parser.util';

@Injectable()
export class DocumentImageIngestionService {
  constructor(
    private readonly imageIndexService: ImageIndexService,
    private readonly objectStorageProvider: ObjectStorageProvider,
    @InjectRepository(DocumentChunkEntity)
    private readonly chunkRepo: Repository<DocumentChunkEntity>,
  ) {}

  isEnabled(): boolean {
    return this.imageIndexService.isEnabled();
  }

  deleteByDoc(docId: string, userId: string): Promise<void> {
    return this.imageIndexService.deleteByDoc(docId, userId);
  }

  async getExpectedIndexAssetCount(
    docId: string,
    filename: string,
    userId: string,
  ): Promise<number> {
    const kind = detectDocumentKind(filename);
    if (kind === 'image') return 1;

    const chunks = await this.chunkRepo.find({
      where: { docId },
      select: ['content'],
    });
    return this.getLocalImageReferences(
      chunks.map((chunk) => chunk.content).join('\n'),
      userId,
    ).length;
  }

  async indexDocumentImages(params: {
    docId: string;
    userId: string;
    filename: string;
    content: string;
    originalUrl: string | null;
    originalBuffer?: Buffer;
  }): Promise<number> {
    const kind = detectDocumentKind(params.filename);
    let assets: ImageIndexInput[] = [];

    if (kind === 'image' && params.originalBuffer) {
      const objectKey = this.getImageObjectKey(params.originalUrl);
      assets = [
        {
          docId: params.docId,
          userId: params.userId,
          url: params.originalUrl ?? undefined,
          embeddingBase64: params.originalBuffer.toString('base64'),
          mimeType: resolveImageMimeType(params.filename),
          assetHash: createHash('sha256')
            .update(params.originalBuffer)
            .digest('hex'),
          assetKey: params.filename,
          meta: {
            filename: params.filename,
            placement: 'original',
            assetKey: objectKey?.split('/').at(-1),
            sourceDocumentId: params.docId,
          },
        },
      ];
    } else if (kind !== 'image') {
      const matches = this.getLocalImageReferences(
        params.content,
        params.userId,
      );
      for (const [index, match] of matches.entries()) {
        const objectKey = match.objectKey;
        const buffer = await this.objectStorageProvider.getObject(objectKey);
        const assetKey = objectKey.split('/images/').at(-1) ?? objectKey;
        assets.push({
          docId: params.docId,
          userId: params.userId,
          url: match.url,
          embeddingBase64: buffer.toString('base64'),
          mimeType: resolveImageMimeType(assetKey),
          assetHash: createHash('sha256').update(buffer).digest('hex'),
          assetKey,
          meta: {
            description: match.alt,
            filename: assetKey.split('/').at(-1),
            placement: match.placement,
            ...(match.placement.startsWith('page-')
              ? { pageNumber: Number(match.placement.slice(5)) }
              : {}),
            ...(match.placement.startsWith('slide-')
              ? { slideNumber: Number(match.placement.slice(6)) }
              : {}),
            assetKey,
            assetIndex: index + 1,
            sourceDocumentId: params.docId,
          },
        });
      }
    }

    await this.imageIndexService.replaceDocumentImages(
      params.docId,
      params.userId,
      assets,
    );
    return assets.length;
  }

  buildImageExtractionOptions(
    docId: string,
    userId: string,
  ): DocumentImageExtractionOptions {
    return {
      storage: this.objectStorageProvider,
      docId,
      ownerUserId: userId,
      urlResolver: (stored) =>
        `/api/v1/documents/assets/image?key=${encodeURIComponent(stored.key)}`,
    };
  }

  private getImageObjectKey(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
      const parsed = new URL(url, 'http://localhost');
      if (parsed.pathname !== '/api/v1/documents/assets/image') return null;
      return parsed.searchParams.get('key');
    } catch {
      return null;
    }
  }

  private getLocalImageReferences(
    content: string,
    userId: string,
  ): Array<{ url: string; alt: string; placement: string; objectKey: string }> {
    const sanitizedUserId =
      userId.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
    const ownerPrefix = `documents/${sanitizedUserId}/`;
    const unique = new Map<
      string,
      { url: string; alt: string; placement: string; objectKey: string }
    >();
    let placement = 'document';
    for (const line of content.split(/\r?\n/)) {
      const pageHeading = /^##\s+第\s+(\d+)\s+页/.exec(line);
      const slideHeading = /^##\s+Slide\s+(\d+)/i.exec(line);
      const frameHeading = /^##\s+画面要点/.exec(line);
      if (pageHeading) placement = `page-${pageHeading[1]}`;
      else if (slideHeading) placement = `slide-${slideHeading[1]}`;
      else if (frameHeading) placement = 'video-frame';

      const imagePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
      for (const match of line.matchAll(imagePattern)) {
        const objectKey = this.getImageObjectKey(match[2]);
        if (
          !objectKey ||
          objectKey.split('/').includes('..') ||
          !objectKey.startsWith(ownerPrefix)
        ) {
          continue;
        }
        if (!unique.has(objectKey)) {
          unique.set(objectKey, {
            url: match[2],
            alt: match[1].trim(),
            placement,
            objectKey,
          });
        }
      }
    }
    return [...unique.values()];
  }
}

function resolveImageMimeType(filename: string): string {
  const extension = filename.toLowerCase().split('.').at(-1);
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    default:
      return 'image/png';
  }
}
