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
} from './document-parser.util';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/api-response.interface';
import { TencentSpeechProvider } from '../../providers/speech/tencent-speech.provider';
import { VisionProvider } from '../../providers/vision/vision.provider';
import { KarpathyObsidianIngestService } from './karpathy-obsidian-ingest.service';

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
      );
    });
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
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
    });
    return { ...result.rag, obsidian: result.obsidian };
  }

  @Post('upload/async')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAsync(
    @UploadedFile() file: Express.Multer.File,
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
      });
    } else {
      setImmediate(() => {
        void this.processAsyncUpload(file, user.userId, task.id);
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
  async uploadUrl(@Body('url') url: string, @CurrentUser() user: JwtPayload) {
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
    });
    return { ...result.rag, obsidian: result.obsidian };
  }

  @Post('manual')
  async uploadManual(
    @Body('title') title: string,
    @Body('content') content: string,
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

    return extractDocumentText(file.buffer, kind);
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
