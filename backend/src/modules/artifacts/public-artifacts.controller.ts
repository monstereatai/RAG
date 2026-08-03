import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ArtifactsService } from './artifacts.service';

@Controller('artifacts/shared')
export class PublicArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  @Get(':token')
  metadata(@Param('token') token: string, @Req() req: Request) {
    return this.artifacts.getSharedMetadata(
      token,
      'external',
      this.context(req),
    );
  }

  @Get(':token/download')
  async download(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.artifacts.getSharedFile(
      token,
      'external',
      this.context(req),
    );
    res.setHeader(
      'Content-Type',
      file.artifact.contentType ?? 'application/octet-stream',
    );
    res.setHeader('Content-Length', String(file.body.length));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.artifact.filename)}`,
    );
    res.send(file.body);
  }

  @Get(':token/preview')
  async preview(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.artifacts.getSharedPreviewFile(
      token,
      'external',
      this.context(req),
    );
    res.setHeader(
      'Content-Type',
      file.artifact.contentType ?? 'application/octet-stream',
    );
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.artifact.filename)}`,
    );
    res.send(file.body);
  }

  private context(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }
}
