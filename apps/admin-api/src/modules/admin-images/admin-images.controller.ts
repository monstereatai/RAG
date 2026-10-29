import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RagClientService } from '../rag-client/rag-client.service';
import { unwrapRagResponse } from '../rag-client/rag-response.adapter';

const RAG_IMAGE_PATH = '/api/v1/documents/assets/image';
const MAX_IMAGE_SEARCH_UPLOAD_BYTES = 5 * 1024 * 1024;

interface ImageSearchResult {
  docId: string;
  url?: string;
  [key: string]: unknown;
}

@ApiTags('admin-images')
@ApiBearerAuth()
@Controller('admin/images')
export class AdminImagesController {
  constructor(private readonly ragClient: RagClientService) {}

  @Get('search')
  @ApiOperation({ summary: '按当前管理员权限搜索图片资产' })
  @RequirePermission('admin:documents:read')
  async search(
    @Query('q') query = '',
    @Query('limit') rawLimit: string | undefined,
    @Req() req: Request,
  ) {
    const principal = this.principal(req);
    const upstream = await this.ragClient.searchImages(
      principal.userId,
      principal.tenantId,
      principal.role,
      query,
      Number(rawLimit) || 20,
    );
    if (!upstream.available || upstream.data === null) {
      throw new HttpException(
        upstream.error || 'RAG image search failed',
        upstream.status && upstream.status >= 400 ? upstream.status : 502,
      );
    }

    const payload = unwrapRagResponse<Record<string, unknown>>(upstream.data);
    const results = Array.isArray(payload.results)
      ? (payload.results as ImageSearchResult[]).map((result) => ({
          ...result,
          url: this.toProxyUrl(result),
        }))
      : [];
    return { ...payload, results };
  }

  @Post('search')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_SEARCH_UPLOAD_BYTES },
    }),
  )
  @ApiOperation({ summary: '上传图片并搜索相似图片资产' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        limit: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @RequirePermission('admin:documents:read')
  async searchByImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('limit') rawLimit: string | undefined,
    @Req() req: Request,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('图片文件不能为空');
    }
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('只支持图片文件');
    }

    const principal = this.principal(req);
    const upstream = await this.ragClient.searchImagesByImage(
      principal.userId,
      principal.tenantId,
      principal.role,
      file,
      Number(rawLimit) || 20,
    );
    if (!upstream.available || upstream.data === null) {
      throw new HttpException(
        upstream.error || 'RAG image search failed',
        upstream.status && upstream.status >= 400 ? upstream.status : 502,
      );
    }

    const payload = unwrapRagResponse<Record<string, unknown>>(upstream.data);
    const results = Array.isArray(payload.results)
      ? (payload.results as ImageSearchResult[]).map((result) => ({
          ...result,
          url: this.toProxyUrl(result),
        }))
      : [];
    return { ...payload, results };
  }

  @Get('asset')
  @ApiOperation({ summary: '按当前管理员权限读取图片资产' })
  @RequirePermission('admin:documents:read')
  async getAsset(
    @Query('docId') docId: string,
    @Query('key') key: string,
    @Req() req: Request,
    @Res() response: Response,
  ) {
    if (!docId?.trim() || !key?.trim()) {
      throw new BadRequestException('docId and key are required');
    }
    const principal = this.principal(req);
    const upstream = await this.ragClient.getImageAsset(
      principal.userId,
      principal.tenantId,
      principal.role,
      docId,
      key,
    );
    await this.pipeImage(upstream, response);
  }

  private principal(req: Request) {
    const user = (req as Request & {
      user?: {
        userId?: string | number;
        sub?: string | number;
        id?: string | number;
        tenantId?: string;
        role?: string;
      };
    }).user;
    const userId = user?.userId ?? user?.sub ?? user?.id;
    if (userId === undefined || userId === null || !String(userId).trim()) {
      throw new HttpException('authenticated user is required', 401);
    }
    return {
      userId: String(userId).trim(),
      tenantId: user.tenantId?.trim() || undefined,
      role: user.role?.trim() || undefined,
    };
  }

  private toProxyUrl(result: ImageSearchResult): string {
    if (!result.docId || !result.url) return '';
    try {
      const parsed = new URL(result.url, 'http://rag.local');
      if (
        parsed.origin !== 'http://rag.local' ||
        parsed.pathname !== RAG_IMAGE_PATH
      ) {
        return '';
      }
      const key = parsed.searchParams.get('key');
      if (!key) return '';
      const params = new URLSearchParams({ docId: result.docId, key });
      return `/api/admin/images/asset?${params.toString()}`;
    } catch {
      return '';
    }
  }

  private async pipeImage(upstream: globalThis.Response, response: Response) {
    if (!upstream.ok) {
      response.status(upstream.status).send(await upstream.text());
      return;
    }
    const contentType = upstream.headers.get('content-type');
    if (!contentType?.startsWith('image/')) {
      response.status(502).send('RAG returned an invalid image response');
      return;
    }
    response.setHeader('Content-Type', contentType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(Buffer.from(await upstream.arrayBuffer()));
  }
}
