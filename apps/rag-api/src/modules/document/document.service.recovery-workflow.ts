import { Logger, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { FactConflictEntity } from '../../providers/db/entities/fact-conflict.entity';
import { DocumentResourceEntity } from '../../providers/db/entities/document-resource.entity';
import { ObjectStorageProvider } from '../../providers/object-storage/object-storage.provider';
import { DocumentImageIngestionService } from './document-image-ingestion.service';
import { DocumentIndexCoordinator } from './document-index-coordinator.service';
import { DocumentRetrievalDescriptionService } from './document-retrieval-description.service';
import { VisionProvider } from '../../providers/vision/vision.provider';
import { TencentSpeechProvider } from '../../providers/speech/tencent-speech.provider';
import {
  detectDocumentKind,
  extractAudioDocumentText,
  extractDocumentText,
  extractImageDocumentText,
  type DocumentVideoExtractionOptions,
} from './document-parser.util';
import type { UploadOptions, UploadResult } from './document.service.types';
import {
  DocumentLifecycleStatus,
  type GameDocumentType,
} from './document-profile.util';

interface DocumentRecoveryWorkflowContext {
  documentImageIngestionService: DocumentImageIngestionService;
  docMetaRepo: Repository<DocumentMetaEntity>;
  resourceRepo: Repository<DocumentResourceEntity>;
  objectStorageProvider: ObjectStorageProvider;
  visionProvider?: VisionProvider;
  logger: Logger;
  speechProvider?: TencentSpeechProvider;
  documentIndexCoordinator: DocumentIndexCoordinator;
  retrievalDescriptionService: DocumentRetrievalDescriptionService;
  factConflictRepo: Repository<FactConflictEntity>;
  docChunkRepo: Repository<DocumentChunkEntity>;
  buildVideoExtractionOptions: (
    filename: string,
    docId: string,
    userId: string,
  ) => DocumentVideoExtractionOptions;
  imageMimeType: (filename: string) => string;
  upload: (
    filename: string,
    content: string,
    userId: string,
    options?: UploadOptions,
  ) => Promise<UploadResult>;
  removeGraphSource: (docId: string, userId: string) => Promise<void>;
}

export class DocumentRecoveryWorkflow {
  constructor(private readonly context: DocumentRecoveryWorkflowContext) {}

  async rebuildImageIndexFromOriginal(docId: string): Promise<{
    indexed: boolean;
    assetCount: number;
    reason?: string;
  }> {
    if (!this.context.documentImageIngestionService.isEnabled()) {
      return {
        indexed: false,
        assetCount: 0,
        reason: 'image embedding disabled',
      };
    }
    const document = await this.context.docMetaRepo.findOne({
      where: { docId },
    });
    if (!document) {
      return { indexed: false, assetCount: 0, reason: 'document not found' };
    }
    const original = await this.context.resourceRepo.findOne({
      where: { docId, kind: 'original' },
      order: { createdAt: 'DESC' },
    });
    if (!original) {
      return {
        indexed: false,
        assetCount: 0,
        reason: 'original document resource not found',
      };
    }

    const kind = detectDocumentKind(original.filename);
    try {
      const buffer = await this.context.objectStorageProvider.getObject(
        original.objectKey,
      );
      const userId = document.userId ?? 'system';
      const capabilities = this.context.visionProvider?.getCapabilities();
      const imageOptions =
        kind === 'pdf' || kind === 'pptx'
          ? {
              ...this.context.documentImageIngestionService.buildImageExtractionOptions(
                docId,
                userId,
              ),
              vision: capabilities?.imageUnderstanding
                ? this.context.visionProvider
                : undefined,
            }
          : undefined;
      const content =
        kind === 'image'
          ? ''
          : await extractDocumentText(
              buffer,
              kind,
              capabilities?.ocr ? this.context.visionProvider : undefined,
              imageOptions,
              kind === 'video'
                ? this.context.buildVideoExtractionOptions(
                    original.filename,
                    docId,
                    userId,
                  )
                : undefined,
            );
      const assetCount =
        await this.context.documentImageIngestionService.indexDocumentImages({
          docId,
          userId,
          filename: original.filename,
          content,
          originalUrl: original.url,
          originalBuffer: buffer,
        });
      return { indexed: true, assetCount };
    } catch (error) {
      const reason = (error as Error).message;
      this.context.logger.warn(
        `Image index rebuild failed for docId=${docId}: ${reason}`,
      );
      return { indexed: false, assetCount: 0, reason };
    }
  }

  async restoreDocumentFromOriginal(
    docId: string,
  ): Promise<UploadResult | null> {
    const document = await this.context.docMetaRepo.findOne({
      where: { docId },
    });
    if (!document) return null;
    const original = await this.context.resourceRepo.findOne({
      where: { docId, kind: 'original' },
      order: { createdAt: 'DESC' },
    });
    if (!original) throw new Error('original document resource not found');

    const userId = document.userId ?? 'system';
    const buffer = await this.context.objectStorageProvider.getObject(
      original.objectKey,
    );
    const kind = detectDocumentKind(original.filename);
    const capabilities = this.context.visionProvider?.getCapabilities();
    const imageOptions =
      kind === 'pdf' || kind === 'pptx'
        ? {
            ...this.context.documentImageIngestionService.buildImageExtractionOptions(
              docId,
              userId,
            ),
            vision: capabilities?.imageUnderstanding
              ? this.context.visionProvider
              : undefined,
          }
        : undefined;
    const videoOptions =
      kind === 'video'
        ? this.context.buildVideoExtractionOptions(
            original.filename,
            docId,
            userId,
          )
        : undefined;
    const extractedContent =
      kind === 'audio'
        ? await extractAudioDocumentText(
            buffer,
            original.filename,
            this.context.speechProvider,
          )
        : kind === 'image'
          ? await extractImageDocumentText(
              buffer,
              original.filename,
              original.contentType ??
                this.context.imageMimeType(original.filename),
              this.context.visionProvider,
            )
          : await extractDocumentText(
              buffer,
              kind,
              capabilities?.ocr ? this.context.visionProvider : undefined,
              imageOptions,
              videoOptions,
              { preservePdfPages: kind === 'pdf' },
            );
    const content = extractedContent.replace(/\0/g, '').trim();
    if (!content) throw new Error('original document has no extractable text');

    const roleScope = (() => {
      try {
        const parsed: unknown = JSON.parse(document.roleScope ?? '[]');
        return Array.isArray(parsed)
          ? parsed.filter((item): item is string => typeof item === 'string')
          : [];
      } catch {
        return [];
      }
    })();
    this.context.documentIndexCoordinator.removeBm25Chunks(docId, userId);

    const result = await this.context.upload(
      original.filename,
      content,
      userId,
      {
        docId,
        tenantId: document.tenantId ?? 'legacy',
        contentType: original.contentType ?? undefined,
        preservePermissions: true,
        preserveExistingMetadata: true,
        awaitImageIndex: true,
        businessMetadata: {
          projectId: document.projectId,
          activityId: document.activityId,
          region: document.region,
          locale: document.locale,
          channel: document.channel,
          roleScope,
          documentType: document.documentType as GameDocumentType,
          lifecycleStatus: document.lifecycleStatus as DocumentLifecycleStatus,
          supersedesDocId: document.supersedesDocId,
          docVersion: document.docVersion,
          effectiveAt: document.effectiveAt?.toISOString() ?? null,
          expiredAt: document.expiredAt?.toISOString() ?? null,
        },
      },
    );
    return result;
  }

  async delete(docId: string, userId: string): Promise<void> {
    const meta = await this.context.docMetaRepo.findOne({
      where: { docId, userId },
    });
    if (!meta) {
      throw new NotFoundException(`doc ${docId} not found`);
    }

    this.context.logger.log(
      `Deleting doc ${docId} (${meta.filename}) for userId=${userId}`,
    );

    // 先停掉图谱写入，避免删除其它索引后，后台 Worker 又把图数据写回来。
    await this.context.removeGraphSource(docId, userId);

    // 1. 删除 Milvus 中的 chunks
    await this.context.documentIndexCoordinator.removeVectorIndex(docId);

    // 描述向量清理失败时停止删除原文，避免留下无法追溯的检索入口。
    await this.context.retrievalDescriptionService.deleteForDocument({
      tenantId: meta.tenantId ?? 'legacy',
      docId,
    });

    // 2. 删除 BM25 内存索引 + JSON 持久化更新；3. 删除 Elasticsearch 索引（ES 未启用时自动跳过）
    await this.context.documentIndexCoordinator.removeSearchIndexes(
      docId,
      userId,
    );

    // 3.5 文搜图：清理图片向量库（未启用/失败不阻塞删除主流程）
    try {
      await this.context.documentImageIngestionService.deleteByDoc(
        docId,
        userId,
      );
    } catch (err) {
      this.context.logger.warn(
        `Image index delete failed for docId=${docId}: ${(err as Error).message}`,
      );
    }

    // 4. 删除数据库元数据与结构化事实索引
    await this.context.factConflictRepo.delete({ docId, userId });
    await this.context.docChunkRepo.delete({ docId, userId });
    await this.context.resourceRepo.update({ docId, userId }, { docId: null });
    await this.context.docMetaRepo.delete({ docId, userId });

    this.context.logger.log(`Doc ${docId} deleted successfully`);
  }
}
