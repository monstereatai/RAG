import type { RagAdminServiceContext } from './rag-admin.service.context';
import { BadRequestException } from '@nestjs/common';
import {
  detectDocumentKind,
  extractAudioDocumentText,
  extractDocumentText,
  extractImageDocumentText,
} from '../document/document-parser.util';

export class RagAdminIngestionWorkflow {
  constructor(private readonly context: RagAdminServiceContext) {}

  async uploadDocument(
    file: Express.Multer.File,
    userId: string,
    fields: Record<string, unknown> = {},
    trustedAdminPrincipal = false,
  ) {
    const tenantId = await this.validateUploadTenant(
      userId,
      fields,
      trustedAdminPrincipal,
    );
    const kind = detectDocumentKind(file.originalname);
    const content = (
      await this.extractUploadContent(file, kind, userId)
    ).trim();
    if (!content) throw new BadRequestException('document content is empty');
    const businessMetadata = { ...fields };
    delete businessMetadata.ownerUserId;
    delete businessMetadata.tenantId;
    return this.context.documentService.upload(
      file.originalname,
      content,
      userId,
      {
        originalBuffer: file.buffer,
        contentType: file.mimetype,
        tenantId,
        trustedAdminPrincipal,
        businessMetadata: businessMetadata,
      },
    );
  }

  async uploadDocumentAsync(
    file: Express.Multer.File,
    userId: string,
    fields: Record<string, unknown> = {},
    trustedAdminPrincipal = false,
  ) {
    const tenantId = await this.validateUploadTenant(
      userId,
      fields,
      trustedAdminPrincipal,
    );

    if (!this.context.documentQueue.enabled) {
      if (this.context.documentQueue.required) {
        throw new BadRequestException(
          '生产文档处理要求使用 Redis 持久队列，当前队列未初始化，任务未执行。',
        );
      }
      return this.uploadDocument(file, userId, fields, trustedAdminPrincipal);
    }
    const task = await this.context.documentService.createQueuedTask(
      file.originalname,
      userId,
      tenantId,
    );
    const businessMetadata = { ...fields } as Record<string, unknown>;
    delete businessMetadata.ownerUserId;
    delete businessMetadata.tenantId;
    if (!this.context.objectStorageProvider) {
      await this.context.documentService.markTaskFailed(
        task.id,
        'object storage is required for asynchronous document processing',
      );
      throw new BadRequestException(
        'object storage is required for asynchronous document processing',
      );
    }
    const objectKey = `documents/${this.context.sanitizeObjectKeyPart(userId)}/queue/${task.id}/${this.context.sanitizeObjectKeyPart(file.originalname)}`;
    const job = {
      taskId: task.id,
      userId,
      tenantId,
      trustedAdminPrincipal,
      filename: file.originalname,
      objectKey,
      contentType: file.mimetype,
      businessMetadata,
    };
    try {
      await this.context.documentQueue.stageUpload(job);
      await this.context.objectStorageProvider.putObject({
        key: objectKey,
        body: file.buffer,
        contentType: file.mimetype,
      });
      await this.context.documentQueue.promoteUpload(task.id);
    } catch (error) {
      await this.context.documentQueue
        .removeStagedUpload(task.id)
        .catch((cleanupError: unknown) =>
          this.context.logger.warn(
            `staged document job cleanup failed for ${task.id}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          ),
        );
      await this.context.objectStorageProvider
        .deleteObject(objectKey)
        .catch((cleanupError: unknown) =>
          this.context.logger.warn(
            `uploaded object cleanup failed for ${task.id}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          ),
        );
      await this.context.documentService.markTaskFailed(
        task.id,
        error instanceof Error ? error.message : 'document queue unavailable',
      );
      throw error;
    }
    return {
      taskId: task.id,
      status: task.status,
      stage: task.stage,
      progress: task.progress,
      queueEnabled: true,
    };
  }

  getDocumentTask(taskId: string, userId: string) {
    return this.context.documentService.getTask(taskId, userId);
  }

  public async extractUploadContent(
    file: Express.Multer.File,
    kind: ReturnType<typeof detectDocumentKind>,
    userId: string,
  ): Promise<string> {
    if (kind === 'audio') {
      return extractAudioDocumentText(
        file.buffer,
        file.originalname,
        this.context.speechProvider,
      );
    }
    if (kind === 'image') {
      return extractImageDocumentText(
        file.buffer,
        file.originalname,
        file.mimetype,
        this.context.visionProvider,
      );
    }

    const capabilities = this.context.visionProvider?.getCapabilities();
    const imageOptions =
      (kind === 'pdf' || kind === 'pptx') && this.context.objectStorageProvider
        ? {
            storage: this.context.objectStorageProvider,
            vision: capabilities?.imageUnderstanding
              ? this.context.visionProvider
              : undefined,
            ownerUserId: userId,
            urlResolver: (stored: { key: string }) =>
              `/api/v1/documents/assets/image?key=${encodeURIComponent(stored.key)}`,
          }
        : undefined;
    const videoOptions =
      kind === 'video' && this.context.objectStorageProvider
        ? {
            storage: this.context.objectStorageProvider,
            asr: this.context.speechProvider?.isEnabled()
              ? this.context.speechProvider
              : undefined,
            vision: capabilities?.imageUnderstanding
              ? this.context.visionProvider
              : undefined,
            ownerUserId: userId,
            filename: file.originalname,
            urlResolver: (stored: { key: string }) =>
              `/api/v1/documents/assets/image?key=${encodeURIComponent(stored.key)}`,
          }
        : undefined;
    if (kind === 'video' && !videoOptions) {
      throw new BadRequestException(
        '视频入库需要可用的对象存储以保存关键帧；当前文件未建立检索索引。',
      );
    }

    return extractDocumentText(
      file.buffer,
      kind,
      capabilities?.ocr ? this.context.visionProvider : undefined,
      imageOptions,
      videoOptions,
      { preservePdfPages: kind === 'pdf' },
    );
  }

  public async validateUploadTenant(
    userId: string,
    fields: Record<string, unknown>,
    trustedAdminPrincipal = false,
  ): Promise<string | undefined> {
    const requestedTenantId =
      typeof fields.tenantId === 'string'
        ? fields.tenantId.trim() || undefined
        : undefined;
    const tenantId = trustedAdminPrincipal
      ? process.env.RAG_ADMIN_TENANT_ID?.trim()
      : requestedTenantId;
    await this.context.documentPermissionService.assertTenant(
      userId,
      tenantId,
      trustedAdminPrincipal,
    );
    return tenantId;
  }
}
