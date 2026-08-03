import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';
import { ArtifactsService } from './artifacts.service';
import { CreateArtifactDto, CreateArtifactShareDto } from './dto/artifact.dto';

@Controller('rag/admin/artifacts')
@UseGuards(ServiceTokenGuard)
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  @Post()
  create(@Body() body: CreateArtifactDto) {
    return this.artifacts.create(body);
  }

  @Get()
  list(
    @Query('ownerUserId') ownerUserId: string,
    @Query('threadId') threadId?: string,
  ) {
    return this.artifacts.list(this.requireOwner(ownerUserId), threadId);
  }

  @Get(':id')
  async get(
    @Param('id') id: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    return this.artifacts.getViewOwned(id, this.requireOwner(ownerUserId));
  }

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Query('ownerUserId') ownerUserId: string,
    @Res() res: Response,
  ) {
    const file = await this.artifacts.getFileOwned(
      id,
      this.requireOwner(ownerUserId),
    );
    this.sendFile(res, file.artifact, file.body);
  }

  @Post(':id/shares')
  createShare(
    @Param('id') id: string,
    @Query('ownerUserId') ownerUserId: string,
    @Body() body: CreateArtifactShareDto,
  ) {
    return this.artifacts.createShare(id, this.requireOwner(ownerUserId), body);
  }

  @Get(':id/shares')
  listShares(
    @Param('id') id: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    return this.artifacts.listShares(id, this.requireOwner(ownerUserId));
  }

  @Post(':id/shares/:shareId/revoke')
  revokeShare(
    @Param('id') id: string,
    @Param('shareId') shareId: string,
    @Query('ownerUserId') ownerUserId: string,
  ) {
    return this.artifacts.revokeShare(
      id,
      shareId,
      this.requireOwner(ownerUserId),
    );
  }

  @Get('shared/:token/internal')
  getInternalShare(@Param('token') token: string, @Req() req: Request) {
    return this.artifacts.getSharedMetadata(
      token,
      'internal',
      this.context(req),
    );
  }

  @Get('shared/:token/internal/download')
  async downloadInternalShare(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.artifacts.getSharedFile(
      token,
      'internal',
      this.context(req),
    );
    this.sendFile(res, file.artifact, file.body);
  }

  private context(req: Request) {
    return {
      actorUserId: String(req.headers['x-actor-user-id'] ?? ''),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }

  private requireOwner(ownerUserId?: string): string {
    if (!ownerUserId?.trim()) {
      throw new BadRequestException('ownerUserId is required.');
    }
    return ownerUserId.trim();
  }

  private sendFile(
    res: Response,
    artifact: { filename: string; contentType: string | null; size: number },
    body: Buffer,
  ) {
    res.setHeader(
      'Content-Type',
      artifact.contentType ?? 'application/octet-stream',
    );
    res.setHeader('Content-Length', String(body.length));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`,
    );
    res.send(body);
  }
}
