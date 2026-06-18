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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentService } from './document.service';
import {
  detectDocumentKind,
  extractDocumentText,
} from './document-parser.util';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/api-response.interface';

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentController {
  private readonly logger = new Logger(DocumentController.name);

  constructor(private readonly documentService: DocumentService) {}

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
    const content = (await extractDocumentText(file.buffer, kind)).trim();
    if (!content) {
      throw new BadRequestException('document text is empty');
    }

    this.logger.log(
      `Received ${file.originalname}, user=${user.username}, ${content.length} chars`,
    );
    return this.documentService.upload(file.originalname, content, user.userId);
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

  /**
   * 删除文档（Milvus chunks + BM25 索引同步删除）
   */
  @Delete(':docId')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('docId') docId: string, @CurrentUser() user: JwtPayload) {
    await this.documentService.delete(docId, user.userId);
    return { message: `doc ${docId} deleted` };
  }
}
