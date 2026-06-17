import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentService } from './document.service';

@Controller('documents')
export class DocumentController {
  private readonly logger = new Logger(DocumentController.name);

  constructor(private readonly documentService: DocumentService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    if (
      !file.originalname.endsWith('.md') &&
      !file.originalname.endsWith('.markdown')
    ) {
      throw new BadRequestException(
        'only .md / .markdown files are supported in M1',
      );
    }
    const content = file.buffer.toString('utf-8');
    this.logger.log(`Received ${file.originalname}, ${content.length} chars`);
    return this.documentService.upload(file.originalname, content);
  }

  @Get()
  list() {
    return this.documentService.listDocs();
  }

  @Get(':docId')
  get(@Param('docId') docId: string) {
    const meta = this.documentService.getDocMeta(docId);
    if (!meta) {
      throw new BadRequestException(`doc ${docId} not found`);
    }
    return meta;
  }
}
