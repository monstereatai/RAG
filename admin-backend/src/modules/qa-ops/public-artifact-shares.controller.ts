import { Controller, Get, Param, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { RequireLogin } from "../../common/decorators/require-login.decorator";
import { RagClientService } from "../rag-client/rag-client.service";

@ApiTags("artifact-shares")
@Controller("shared/artifacts")
@RequireLogin(false)
export class PublicArtifactSharesController {
  constructor(private readonly ragClient: RagClientService) {}

  @Get(":token")
  @ApiOperation({ summary: "外部分享产物信息" })
  async metadata(@Param("token") token: string) {
    const result = await this.ragClient.getExternalArtifactShare(token);
    if (!result.available) return { available: false, status: result.status, error: result.error };
    return this.unwrap(result.data);
  }

  @Get(":token/download")
  @ApiOperation({ summary: "下载外部分享产物" })
  async download(@Param("token") token: string, @Res() res: Response) {
    const upstream = await this.ragClient.downloadExternalArtifactShare(token);
    await this.pipe(upstream, res);
  }

  @Get(":token/preview")
  @ApiOperation({ summary: "预览外部分享产物" })
  async preview(@Param("token") token: string, @Res() res: Response) {
    const upstream = await this.ragClient.previewExternalArtifactShare(token);
    await this.pipe(upstream, res);
  }

  private unwrap(payload: unknown) {
    return (payload as { data?: unknown } | null)?.data ?? payload;
  }

  private async pipe(upstream: globalThis.Response, res: Response) {
    if (!upstream.ok) {
      res.status(upstream.status).send(await upstream.text());
      return;
    }
    for (const name of ["content-type", "content-length", "content-disposition"]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.send(Buffer.from(await upstream.arrayBuffer()));
  }
}
