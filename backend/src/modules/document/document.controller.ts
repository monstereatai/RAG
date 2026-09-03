import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Logger,
  UseGuards,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentService } from './document.service';
import { DocumentQueueService } from './document-queue.service';
import {
  detectDocumentKind,
  extractDocumentText,
  extractUrlContent,
  SupportedDocumentKind,
  DocumentImageExtractionOptions,
} from './document-parser.util';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/api-response.interface';
import { TencentSpeechProvider } from '../../providers/speech/tencent-speech.provider';
import { VisionProvider } from '../../providers/vision/vision.provider';
import { ObjectStorageProvider } from '../../providers/object-storage/object-storage.provider';
import { KarpathyObsidianIngestService } from './karpathy-obsidian-ingest.service';
import {
  DocumentLifecycleStatus,
  DocumentBusinessMetadata,
  GameDocumentMetadata,
  GameDocumentType,
} from './document-profile.util';

type DocumentUploadBody = Partial<
  Record<
    | 'projectId'
    | 'activityId'
    | 'region'
    | 'locale'
    | 'channel'
    | 'roleScope'
    | 'documentType'
    | 'lifecycleStatus'
    | 'supersedesDocId'
    | 'docVersion'
    | 'effectiveAt'
    | 'expiredAt',
    string | string[]
  >
>;

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentController {
  private readonly logger = new Logger(DocumentController.name);

  constructor(
    private readonly documentService: DocumentService,
    private readonly speechProvider: TencentSpeechProvider,
    private readonly visionProvider: VisionProvider,
    private readonly documentQueue: DocumentQueueService,
    private readonly karpathyObsidianIngest: KarpathyObsidianIngestService,
    private readonly objectStorageProvider: ObjectStorageProvider,
  ) {
    this.documentQueue.registerProcessor(async (job) => {
      return this.processAsyncUpload(
        {
          originalname: job.filename,
          mimetype: job.contentType ?? 'application/octet-stream',
          buffer: Buffer.from(job.originalBufferBase64, 'base64'),
        } as Express.Multer.File,
        job.userId,
        job.taskId,
        job.businessMetadata,
      );
    });
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: DocumentUploadBody,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const kind = detectDocumentKind(file.originalname);
    const content = (await this.extractUploadContent(file, kind)).trim();
    if (!content) {
      throw new BadRequestException('document text is empty');
    }

    this.logger.log(
      `Received ${file.originalname}, user=${user.username}, ${content.length} chars`,
    );
    const result = await this.karpathyObsidianIngest.ingestText({
      title: file.originalname,
      content,
      userId: user.userId,
      filename: file.originalname,
      sourceType: 'document',
      contentType: file.mimetype,
      originalBuffer: file.buffer,
      businessMetadata: this.parseBusinessMetadata(body),
    });
    return { ...result.rag, obsidian: result.obsidian };
  }

  @Post('upload/async')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAsync(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: DocumentUploadBody,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const task = await this.documentService.createQueuedTask(
      file.originalname,
      user.userId,
    );

    if (this.documentQueue.enabled) {
      await this.documentQueue.enqueue({
        taskId: task.id,
        userId: user.userId,
        filename: file.originalname,
        originalBufferBase64: file.buffer.toString('base64'),
        contentType: file.mimetype,
        businessMetadata: this.parseBusinessMetadata(body),
      });
    } else {
      setImmediate(() => {
        void this.processAsyncUpload(
          file,
          user.userId,
          task.id,
          this.parseBusinessMetadata(body),
        );
      });
    }

    return {
      taskId: task.id,
      status: task.status,
      stage: task.stage,
      progress: task.progress,
      queueEnabled: this.documentQueue.enabled,
    };
  }

  @Post('url')
  async uploadUrl(
    @Body('url') url: string,
    @Body() body: DocumentUploadBody,
    @CurrentUser() user: JwtPayload,
  ) {
    const extracted = await extractUrlContent(url);
    const content = extracted.content.trim();
    if (!content) {
      throw new BadRequestException('url content is empty');
    }

    this.logger.log(
      `Received url ${url}, user=${user.username}, ${content.length} chars`,
    );
    const result = await this.karpathyObsidianIngest.ingestUrl({
      url,
      extracted,
      userId: user.userId,
      filename: this.getUrlSnapshotFilename(extracted.finalUrl),
      businessMetadata: this.parseBusinessMetadata(body),
    });
    return { ...result.rag, obsidian: result.obsidian };
  }

  @Post('manual')
  async uploadManual(
    @Body('title') title: string,
    @Body('content') content: string,
    @Body() body: DocumentUploadBody,
    @CurrentUser() user: JwtPayload,
  ) {
    const normalizedTitle = title?.trim() || 'Manual Note';
    const normalizedContent = content?.trim();
    if (!normalizedContent) {
      throw new BadRequestException('content is required');
    }

    const filename = `${normalizedTitle.replace(/[\\/:*?"<>|#\[\]\n\r\t]+/g, ' ').trim() || 'manual-note'}.md`;
    const result = await this.karpathyObsidianIngest.ingestText({
      title: normalizedTitle,
      content: normalizedContent,
      userId: user.userId,
      filename,
      sourceType: 'manual',
      contentType: 'text/markdown',
      originalBuffer: Buffer.from(normalizedContent, 'utf8'),
      businessMetadata: this.parseBusinessMetadata(body),
    });
    return { ...result.rag, obsidian: result.obsidian };
  }

  @Get('tasks/:taskId')
  async getTask(
    @Param('taskId') taskId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const task = await this.documentService.getTask(taskId, user.userId);
    if (!task) {
      throw new BadRequestException(`task ${taskId} not found`);
    }
    return task;
  }

  /**
   * 删除文档（Milvus chunks + BM25 索引同步删除）
   */
  @Delete(':docId')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('docId') docId: string, @CurrentUser() user: JwtPayload) {
    await this.documentService.delete(docId, user.userId);
    return { message: `doc ${docId} deleted` };
  }

  private async processAsyncUpload(
    file: Express.Multer.File,
    userId: string,
    taskId: string,
    businessMetadata?: DocumentBusinessMetadata,
  ): Promise<{ chunkCount: number }> {
    const kind = detectDocumentKind(file.originalname);
    const content = (await this.extractUploadContent(file, kind)).trim();
    if (!content) {
      await this.documentService.markTaskFailed(
        taskId,
        'document text is empty',
      );
      throw new BadRequestException('document text is empty');
    }
    const result = await this.karpathyObsidianIngest.ingestText({
      title: file.originalname,
      content,
      userId,
      filename: file.originalname,
      sourceType: 'document',
      contentType: file.mimetype,
      originalBuffer: file.buffer,
      taskId,
      businessMetadata,
    });
    return { chunkCount: result.rag.chunkCount };
  }

  /**
   * 获取文档处理队列状态（管理后台用）
   */
  @Get('queue/status')
  async getQueueStatus() {
    const caps = this.visionProvider.getCapabilities();
    return {
      documentQueue: await this.documentQueue.getStatus(),
      vision: caps,
    };
  }

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.documentService.listDocs(user.userId);
  }

  @Get(':docId')
  async get(@Param('docId') docId: string, @CurrentUser() user: JwtPayload) {
    const meta = await this.documentService.getDocMeta(docId, user.userId);
    if (!meta) {
      throw new BadRequestException(`doc ${docId} not found`);
    }
    return meta;
  }

  private async extractUploadContent(
    file: Express.Multer.File,
    kind: SupportedDocumentKind,
  ): Promise<string> {
    if (kind === 'audio') {
      try {
        const format =
          file.originalname.split('.').pop()?.toLowerCase() ?? 'wav';
        const transcript = await this.speechProvider.transcribe(
          file.buffer,
          format === 'm4a' ? 'mp4' : format,
        );
        return [
          '# Audio Transcript',
          '',
          transcript || 'ASR returned an empty transcript.',
        ].join('\n');
      } catch (err) {
        this.logger.warn(
          `Audio ASR failed for ${file.originalname}: ${
            (err as Error).message
          }`,
        );
      }
    }

    // 图片：调用视觉 provider 做 OCR / 图像理解
    if (kind === 'image') {
      try {
        const caps = this.visionProvider.getCapabilities();
        const blocks: string[] = ['# Image Document', ''];

        if (caps.ocr) {
          const ocrResult = await this.visionProvider.ocr(
            file.buffer,
            file.mimetype,
          );
          blocks.push('## OCR 识别文字', '', ocrResult.text || '(无文字)', '');
        }

        if (caps.imageUnderstanding) {
          const desc = await this.visionProvider.describeImage(
            file.buffer,
            file.mimetype,
          );
          blocks.push('## 图像描述', '', desc.description, '');
          if (desc.tags.length > 0) {
            blocks.push('标签：' + desc.tags.join('、'));
          }
        }

        return blocks.join('\n');
      } catch (err) {
        this.logger.warn(
          `Vision processing failed for image ${file.originalname}: ${
            (err as Error).message
          }`,
        );
        // 降级到默认 fallback
      }
    }

    // 视频：调用视觉 provider 做视频理解
    if (kind === 'video') {
      try {
        if (this.visionProvider.getCapabilities().videoUnderstanding) {
          const videoDesc = await this.visionProvider.describeVideo(
            file.buffer,
            file.mimetype,
          );
          return [
            '# Video Document',
            '',
            '## 视频摘要',
            '',
            videoDesc.summary,
            '',
            videoDesc.transcript
              ? ['## 音频转写', '', videoDesc.transcript].join('\n')
              : '',
          ].join('\n');
        }
      } catch (err) {
        this.logger.warn(
          `Vision processing failed for video ${file.originalname}: ${
            (err as Error).message
          }`,
        );
        // 降级到默认 fallback
      }
    }

    // PDF 无文本层（扫描件）时，extractDocumentText 会用 vision provider 兜底 OCR；
    // 未配置 vision provider 时对扫描件抛出明确错误，不会静默入库空文档。
    // PDF / PPTX 内嵌图片提取参数见 buildImageExtractionOptions。
    return extractDocumentText(
      file.buffer,
      kind,
      this.visionProvider,
      this.buildImageExtractionOptions(),
    );
  }

  /**
   * 组装内嵌图片提取参数（PDF / PPTX → 对象存储 → Markdown ![alt](url)）。
   *
   * - 开关 DOCUMENT_EXTRACT_IMAGES 关闭（解析器默认开启）时不提取；
   * - VISION_PROVIDER 已配置时传 vision 委托，用视觉模型批量生成 alt 描述；
   *   未配置时解析器直接用文件名作 alt，不发起任何 vision 调用；
   * - 对象存储异常由解析器静默降级为纯文本，不影响主入库链路。
   */
  private buildImageExtractionOptions():
    | DocumentImageExtractionOptions
    | undefined {
    if (process.env.DOCUMENT_EXTRACT_IMAGES === 'false') {
      return undefined;
    }
    return {
      storage: this.objectStorageProvider,
      vision: process.env.VISION_PROVIDER ? this.visionProvider : undefined,
    };
  }

  private parseBusinessMetadata(
    body: DocumentUploadBody,
  ): DocumentBusinessMetadata | undefined {
    const text = (key: keyof DocumentUploadBody): string | undefined => {
      const value = body?.[key];
      const normalized = Array.isArray(value) ? value[0] : value;
      return normalized?.trim() || undefined;
    };
    const roleValue = body?.roleScope;
    const roleScope = (
      Array.isArray(roleValue) ? roleValue : roleValue?.split(',')
    )
      ?.map((item) => item.trim())
      .filter(Boolean);
    const metadata: DocumentBusinessMetadata = {
      projectId: text('projectId') ?? null,
      activityId: text('activityId') ?? null,
      region: text('region') ?? null,
      locale: text('locale') ?? null,
      channel: text('channel') ?? null,
      roleScope,
      documentType: text('documentType') as GameDocumentType | undefined,
      lifecycleStatus: text('lifecycleStatus') as
        | DocumentLifecycleStatus
        | undefined,
      supersedesDocId: text('supersedesDocId') ?? null,
      docVersion: text('docVersion') ?? null,
      effectiveAt: text('effectiveAt') ?? null,
      expiredAt: text('expiredAt') ?? null,
    };
    return Object.values(metadata).some((value) =>
      Array.isArray(value) ? value.length > 0 : value != null,
    )
      ? metadata
      : undefined;
  }

  private getUrlSnapshotFilename(url: string): string {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/\/$/, '') || '/index';
      return `${parsed.hostname}${path}.url.md`.replace(/[^\w./-]+/g, '_');
    } catch {
      return 'url-snapshot.md';
    }
  }
}
