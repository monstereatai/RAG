import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Logger,
  Param,
  Patch,
  Post,
  UnauthorizedException,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { RagClientService } from "../rag-client/rag-client.service";
import { QaOpsAguiStreamProxyService } from "./qa-ops-agui-stream-proxy.service";

@ApiTags("admin-qa-ops")
@ApiBearerAuth()
@Controller("admin/qa-ops")
export class QaOpsController {
  private readonly logger = new Logger(QaOpsController.name);

  constructor(
    private readonly ragClient: RagClientService,
    private readonly aguiStreamProxy: QaOpsAguiStreamProxyService,
  ) {}

  @Post("attachments")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  @RequirePermission("admin:qa-ops:write")
  async uploadConversationAttachment(
    @UploadedFile() file: Express.Multer.File,
    @Body("threadId") threadId: string,
    @Req() req: Request,
  ) {
    if (!file?.buffer?.length) {
      throw new HttpException("请选择有效文件", 400);
    }
    if (!threadId) throw new HttpException("threadId is required", 400);
    const result = await this.ragClient.uploadQaConversationAttachment(
      file,
      this.getUserId(req),
      threadId,
    );
    this.requireAvailable(result);
    return { data: this.unwrapObject(result.data), available: result.available };
  }

  @Get("attachments")
  @RequirePermission("admin:qa-ops:read")
  async listConversationAttachments(
    @Query("threadId") threadId: string,
    @Req() req: Request,
  ) {
    if (!threadId) throw new HttpException("threadId is required", 400);
    const result = await this.ragClient.listQaConversationAttachments(
      this.getUserId(req),
      threadId,
    );
    this.requireAvailable(result);
    return { data: this.unwrapList(result.data), available: result.available };
  }

  @Delete("attachments")
  @RequirePermission("admin:qa-ops:write")
  async deleteConversationAttachments(
    @Query("threadId") threadId: string,
    @Req() req: Request,
  ) {
    if (!threadId) throw new HttpException("threadId is required", 400);
    const result = await this.ragClient.deleteQaConversationAttachments(
      this.getUserId(req),
      threadId,
    );
    this.requireAvailable(result);
    return { data: this.unwrapObject(result.data), available: result.available };
  }

  @Delete("attachments/:attachmentId")
  @RequirePermission("admin:qa-ops:write")
  async deleteConversationAttachment(
    @Param("attachmentId") attachmentId: string,
    @Query("threadId") threadId: string,
    @Req() req: Request,
  ) {
    if (!threadId) throw new HttpException("threadId is required", 400);
    const result = await this.ragClient.deleteQaConversationAttachment(
      attachmentId,
      this.getUserId(req),
      threadId,
    );
    this.requireAvailable(result);
    return { data: this.unwrapObject(result.data), available: result.available };
  }

  @Post("artifacts")
  @ApiOperation({ summary: "生成可传播文件" })
  @RequirePermission("admin:qa-ops:write")
  async createArtifact(@Body() body: any, @Req() req: Request) {
    const result = await this.ragClient.createArtifact({
      ...body,
      ownerUserId: this.getUserId(req),
    });
    this.requireAvailable(result);
    return { data: this.unwrapObject(result.data), available: result.available, error: result.error };
  }

  @Get("artifacts")
  @ApiOperation({ summary: "生成文件列表" })
  @RequirePermission("admin:qa-ops:read")
  async listArtifacts(@Req() req: Request, @Query("threadId") threadId?: string) {
    const result = await this.ragClient.listArtifacts(this.getUserId(req), threadId);
    this.requireAvailable(result);
    return { data: this.unwrapList(result.data), available: result.available, error: result.error };
  }

  @Get("artifacts/:id")
  @ApiOperation({ summary: "生成文件详情" })
  @RequirePermission("admin:qa-ops:read")
  async getArtifact(@Param("id") id: string, @Req() req: Request) {
    const result = await this.ragClient.getArtifact(id, this.getUserId(req));
    this.requireAvailable(result);
    return { data: this.unwrapObject(result.data), available: result.available, error: result.error };
  }

  @Get("artifacts/:id/download")
  @ApiOperation({ summary: "下载生成文件" })
  @RequirePermission("admin:qa-ops:read")
  async downloadArtifact(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    await this.pipeArtifact(await this.ragClient.downloadArtifact(id, this.getUserId(req)), res);
  }

  @Post("artifacts/:id/shares")
  @ApiOperation({ summary: "创建内部或外部分享" })
  @RequirePermission("admin:qa-ops:write")
  async createArtifactShare(@Param("id") id: string, @Body() body: any, @Req() req: Request) {
    const userId = this.getUserId(req);
    const result = await this.ragClient.createArtifactShare(id, userId, { ...body, createdBy: userId });
    this.requireAvailable(result);
    return { data: this.unwrapObject(result.data), available: result.available, error: result.error };
  }

  @Get("artifacts/:id/shares")
  @ApiOperation({ summary: "文件分享记录" })
  @RequirePermission("admin:qa-ops:read")
  async listArtifactShares(@Param("id") id: string, @Req() req: Request) {
    const result = await this.ragClient.listArtifactShares(id, this.getUserId(req));
    this.requireAvailable(result);
    return { data: this.unwrapList(result.data), available: result.available, error: result.error };
  }

  @Post("artifacts/:id/shares/:shareId/revoke")
  @ApiOperation({ summary: "撤销文件分享" })
  @RequirePermission("admin:qa-ops:write")
  async revokeArtifactShare(@Param("id") id: string, @Param("shareId") shareId: string, @Req() req: Request) {
    const result = await this.ragClient.revokeArtifactShare(id, shareId, this.getUserId(req));
    this.requireAvailable(result);
    return { data: this.unwrapObject(result.data), available: result.available, error: result.error };
  }

  @Get("artifact-shares/:token")
  @ApiOperation({ summary: "内部分享产物信息" })
  @RequirePermission("admin:qa-ops:read")
  async getInternalArtifactShare(@Param("token") token: string, @Req() req: Request) {
    const result = await this.ragClient.getInternalArtifactShare(token, this.getUserId(req));
    this.requireAvailable(result);
    return { data: this.unwrapObject(result.data), available: result.available, error: result.error };
  }

  @Get("artifact-shares/:token/download")
  @ApiOperation({ summary: "下载内部分享产物" })
  @RequirePermission("admin:qa-ops:read")
  async downloadInternalArtifactShare(@Param("token") token: string, @Req() req: Request, @Res() res: Response) {
    await this.pipeArtifact(await this.ragClient.downloadInternalArtifactShare(token, this.getUserId(req)), res);
  }

  // ─── Conversation CRUD ───────────────────────────────────────

  @Get("conversations")
  @ApiOperation({ summary: "会话列表" })
  @RequirePermission("admin:qa-ops:read")
  async listConversations(@Req() req: Request) {
    const result = await this.ragClient.getConversations(this.getUserId(req));
    // 只读运营列表采用稳定契约：上游不可用时返回空列表和可用性信息，
    // 不把 RAG 后端的瞬时不可达转换成页面级 502。
    return {
      data: this.unwrapList(result.data),
      available: result.available,
      status: result.status,
      error: result.error,
    };
  }

  @Get("role-presets")
  @ApiOperation({ summary: "AI 问答岗位预设目录" })
  @RequirePermission("admin:qa-ops:read")
  async getRolePresets() {
    const result = await this.ragClient.getRolePresets();
    return { data: this.unwrapObject(result.data) };
  }

  @Get("conversations/:threadId")
  @ApiOperation({ summary: "会话详情（含消息）" })
  @RequirePermission("admin:qa-ops:read")
  async getConversation(@Param("threadId") threadId: string, @Req() req: Request) {
    const result = await this.ragClient.getConversation(threadId, this.getUserId(req));
    this.requireAvailable(result);
    return { data: this.unwrapObject(result.data) };
  }

  @Post("conversations/:threadId/bad-case")
  @ApiOperation({ summary: "提交会话 Bad Case" })
  @RequirePermission("admin:qa-ops:write")
  async submitBadCase(
    @Param("threadId") threadId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request
  ) {
    const result = await this.ragClient.submitQaFeedback(this.getUserId(req), {
      ...body,
      threadId,
      feedback: "negative",
    });
    this.requireAvailable(result);
    return { success: result.available, data: result.data };
  }

  @Delete("conversations/:threadId")
  @ApiOperation({ summary: "删除会话" })
  @RequirePermission("admin:qa-ops:read")
  async deleteConversation(@Param("threadId") threadId: string, @Req() req: Request) {
    await this.ragClient.deleteConversation(threadId, this.getUserId(req));
    return { success: true };
  }

  @Get("overview")
  @ApiOperation({ summary: "AI 问答运营概览" })
  @RequirePermission("admin:qa-ops:read")
  async overview() {
    const [negativeFeedback, citationFailures, costSummary, qualitySummary] = await Promise.all(
      [
        this.ragClient.getQaNegativeFeedback(),
        this.ragClient.getQaCitationFailures(),
        this.ragClient.getQaCostSummary(),
        this.ragClient.getRagQualitySummary(),
      ]
    );

    return {
      status:
        negativeFeedback.available &&
        citationFailures.available &&
        costSummary.available
        && qualitySummary.available
          ? "available"
          : negativeFeedback.available ||
            citationFailures.available ||
            costSummary.available ||
            qualitySummary.available
          ? "partial"
          : "unavailable",
      data: {
        negativeFeedback: negativeFeedback.data ?? [],
        citationFailures: citationFailures.data ?? [],
        costSummary: costSummary.data ?? null,
        qualitySummary: qualitySummary.data ?? null,
      },
      upstream: { negativeFeedback, citationFailures, costSummary, qualitySummary },
    };
  }

  @Get("records")
  @ApiOperation({ summary: "QA 记录列表（前端 qa-ops 页面）" })
  @RequirePermission("admin:qa-ops:read")
  async getRecords(@Query() query: any) {
    const feedback = await this.ragClient.getQaFeedback({
      status: query.status,
      feedback: query.feedback,
      limit: 200,
    });
    const page = Number(query.current) || 1;
    const pageSize = Number(query.pageSize) || 10;
    const items = (Array.isArray(feedback.data) ? feedback.data : []) as any[];
    return {
      data: items
        .slice((page - 1) * pageSize, page * pageSize)
        .map((item: any, index: number) => ({
          id: item.id ?? String(index + 1),
          question: item.question ?? item.query ?? "",
          answer: item.answer ?? "",
          mode: item.mode ?? "simple",
          confidence: item.confidence ?? 0.7,
          sourcesCount: item.sourcesCount ?? 3,
          userId: item.userId ?? "system",
          createdAt: item.createdAt ?? new Date().toISOString(),
          feedback: item.feedback ?? null,
          errorType: item.errorType ?? null,
          status: item.status ?? "pending",
          correctedAnswer: item.correctedAnswer ?? null,
          includeInRegression: item.includeInRegression ?? false,
        })),
      total: items.length,
    };
  }

  @Get("stats")
  @ApiOperation({ summary: "QA 统计（前端 qa-ops 页面）" })
  @RequirePermission("admin:qa-ops:read")
  async getStats() {
    const result = await this.ragClient.getQaFeedback({ limit: 200 });
    const items = (Array.isArray(result.data) ? result.data : []) as any[];
    const positive = items.filter(
      (item) => item.feedback === "positive"
    ).length;
    const negative = items.filter(
      (item) => item.feedback === "negative"
    ).length;
    const total = items.length;
    return {
      data: {
        totalQa: total,
        avgConfidence: null,
        positiveRate: total > 0 ? positive / total : 0,
        negativeRate: total > 0 ? negative / total : 0,
      },
    };
  }

  // 浏览器只访问管理 API：这里校验权限、映射管理员身份并转发 SSE，RAG 服务令牌不会下发到浏览器。
  @Get("agui/stream")
  @ApiOperation({ summary: "代理 RAG AG-UI 流式问答" })
  @RequirePermission("admin:qa-ops:read")
  async streamAgui(
    @Query("query") query: string,
    @Query("mode") mode: "simple" | "agentic" | "auto" = "auto",
    @Query("model") model: "qwen" | "deepseek" | "zhipu" = "qwen",
    @Query("threadId") threadId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
    @Query("rolePresetId") rolePresetId?: string,
    @Query("pluginKeys") pluginKeys?: string,
    @Query("attachmentIds") attachmentIds?: string,
  ) {
    if (!query?.trim()) {
      res.status(400).json({ message: "query is required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const traceContext = (
      req as Request & {
        traceContext?: { traceId: string; spanId: string };
      }
    ).traceContext;
    const requestId = (req as Request & { requestId?: string }).requestId;
    const traceparent =
      traceContext &&
      /^[0-9a-f]{32}$/i.test(traceContext.traceId) &&
      /^[0-9a-f]{16}$/i.test(traceContext.spanId)
        ? `00-${traceContext.traceId}-${traceContext.spanId}-01`
        : undefined;

    await this.aguiStreamProxy.proxy(
      {
        query,
        mode,
        model: this.parseModel(model),
        threadId,
        rolePresetId,
        pluginKeys: pluginKeys?.split(",").map((item) => item.trim()).filter(Boolean),
        attachmentIds: attachmentIds?.split(",").map((item) => item.trim()).filter(Boolean),
        userId: this.getUserId(req),
      },
      res,
      traceparent,
      requestId,
    );
  }

  @Get("plugins")
  @RequirePermission("admin:qa-ops:read")
  async qaPlugins() {
    const result = await this.ragClient.listPlatformPlugins();
    return {
      data: this.unwrapList(result.data),
      available: result.available,
      status: result.status,
      error: result.error,
    };
  }

  @Patch("records/:id/feedback")
  @ApiOperation({ summary: "更新 QA 反馈" })
  @RequirePermission("admin:qa-ops:write")
  async updateFeedback(
    @Param("id") id: string,
    @Body()
    body: {
      status?: "pending" | "reviewed" | "resolved" | "ignored";
      errorType?: string;
      correctedAnswer?: string;
      includeInRegression?: boolean;
    }
  ) {
    const result = await this.ragClient.reviewQaFeedback(id, body);
    return { success: result.available, data: result.data };
  }

  private getUserId(req: Request) {
    const user = (req as Request & {
      user?: { userId?: string | number; id?: string | number; sub?: string | number };
    }).user;
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (id === undefined || id === null || !String(id).trim()) {
      throw new UnauthorizedException('authenticated user is required');
    }
    return String(id).trim();
  }

  private requireAvailable(result: { available: boolean; status: number | null; error?: string }) {
    if (!result.available) {
      throw new HttpException(
        result.error || "RAG service request failed",
        result.status && result.status >= 400 ? result.status : 502
      );
    }
  }

  private async pipeArtifact(upstream: globalThis.Response, res: Response) {
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

  private parseModel(model?: string): "qwen" | "deepseek" | "zhipu" {
    if (!model) return "qwen";
    if (model === "qwen" || model === "deepseek" || model === "zhipu") return model;
    return "qwen";
  }

  private unwrapList(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    const data = (payload as { data?: unknown } | null)?.data;
    if (Array.isArray(data)) return data;
    return [];
  }

  private unwrapObject(payload: unknown): unknown | null {
    const data = (payload as { data?: unknown } | null)?.data;
    return data ?? payload ?? null;
  }

  @Get("negative-feedback")
  @ApiOperation({ summary: "差评样本" })
  @RequirePermission("admin:qa-ops:read")
  async getNegativeFeedback() {
    return this.ragClient.getQaNegativeFeedback();
  }

  @Get("citation-failures")
  @ApiOperation({ summary: "引用失败样本" })
  @RequirePermission("admin:qa-ops:read")
  async getCitationFailures() {
    return this.ragClient.getQaCitationFailures();
  }

  @Get("cost-summary")
  @ApiOperation({ summary: "成本统计" })
  @RequirePermission("admin:qa-ops:read")
  async getCostSummary() {
    return this.ragClient.getQaCostSummary();
  }
}
