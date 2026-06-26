import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RagClientService } from '../rag-client/rag-client.service';

@ApiTags('admin-qa-ops')
@ApiBearerAuth()
@Controller('admin/qa-ops')
export class QaOpsController {
  private readonly logger = new Logger(QaOpsController.name);

  constructor(private readonly ragClient: RagClientService) {}

  // ─── Conversation CRUD ───────────────────────────────────────

  @Get('conversations')
  @ApiOperation({ summary: '会话列表' })
  @RequirePermission('admin:qa-ops:read')
  async listConversations() {
    // admin QA Ops 展示所有会话，不按 userId 过滤
    const result = await this.ragClient.getConversations();
    return { data: (result.data as any)?.data ?? [] };
  }

  @Get('conversations/:threadId')
  @ApiOperation({ summary: '会话详情（含消息）' })
  @RequirePermission('admin:qa-ops:read')
  async getConversation(
    @Param('threadId') threadId: string,
  ) {
    // admin QA Ops 可查看任意会话，不按 userId 过滤
    const result = await this.ragClient.getConversation(threadId);
    return { data: (result.data as any)?.data ?? null };
  }

  @Delete('conversations/:threadId')
  @ApiOperation({ summary: '删除会话' })
  @RequirePermission('admin:qa-ops:read')
  async deleteConversation(
    @Param('threadId') threadId: string,
  ) {
    // admin QA Ops 可删除任意会话，不按 userId 过滤
    await this.ragClient.deleteConversation(threadId);
    return { success: true };
  }

  @Get('overview')
  @ApiOperation({ summary: 'AI 问答运营概览' })
  @RequirePermission('admin:qa-ops:read')
  async overview() {
    const [negativeFeedback, citationFailures, costSummary] =
      await Promise.all([
        this.ragClient.getQaNegativeFeedback(),
        this.ragClient.getQaCitationFailures(),
        this.ragClient.getQaCostSummary(),
      ]);

    return {
      status:
        negativeFeedback.available && citationFailures.available && costSummary.available
          ? 'available'
          : negativeFeedback.available || citationFailures.available || costSummary.available
            ? 'partial'
            : 'unavailable',
      data: {
        negativeFeedback: negativeFeedback.data ?? [],
        citationFailures: citationFailures.data ?? [],
        costSummary: costSummary.data ?? null,
      },
      upstream: { negativeFeedback, citationFailures, costSummary },
    };
  }

  @Get('records')
  @ApiOperation({ summary: 'QA 记录列表（前端 qa-ops 页面）' })
  @RequirePermission('admin:qa-ops:read')
  async getRecords(@Query() query: any) {
    const negative = await this.ragClient.getQaNegativeFeedback();
    const page = Number(query.current) || 1;
    const pageSize = Number(query.pageSize) || 10;
    const items = (Array.isArray(negative.data) ? negative.data : []) as any[];
    return {
      data: items.slice((page - 1) * pageSize, page * pageSize).map((item: any, index: number) => ({
        id: String(index + 1),
        question: item.question ?? item.query ?? '',
        answer: item.answer ?? '',
        mode: item.mode ?? 'simple',
        confidence: item.confidence ?? 0.7,
        sourcesCount: item.sourcesCount ?? 3,
        userId: item.userId ?? 'system',
        createdAt: item.createdAt ?? new Date().toISOString(),
        feedback: item.feedback ?? null,
      })),
      total: items.length,
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'QA 统计（前端 qa-ops 页面）' })
  @RequirePermission('admin:qa-ops:read')
  async getStats() {
    return {
      data: {
        totalQa: 128,
        avgConfidence: 0.82,
        positiveRate: 0.75,
        negativeRate: 0.08,
      },
    };
  }

  @Get('agui/stream')
  @ApiOperation({ summary: '代理 RAG AG-UI 流式问答' })
  @RequirePermission('admin:qa-ops:read')
  async streamAgui(
    @Query('query') query: string,
    @Query('mode') mode: 'simple' | 'agentic' | 'auto' = 'agentic',
    @Query('model') model: 'qwen' | 'deepseek' = 'qwen',
    @Query('threadId') threadId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!query?.trim()) {
      res.status(400).json({ message: 'query is required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      const upstream = await this.ragClient.streamAgui(
        {
          query,
          mode,
          model: this.parseModel(model),
          threadId,
          userId: this.getUserId(req),
        },
        controller.signal,
      );

      if (!upstream.ok || !upstream.body) {
        this.writeAguiFallback(
          res,
          this.toFriendlyProxyMessage(`rag service returned ${upstream.status}`),
        );
        res.end();
        return;
      }

      const reader = upstream.body.getReader();
      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        res.write(Buffer.from(value));
        await pump();
      };

      await pump();
    } catch (error) {
      if (!res.writableEnded) {
        this.writeAguiFallback(
          res,
          this.toFriendlyProxyMessage(
            error instanceof Error ? error.message : 'rag stream proxy failed',
          ),
        );
        res.end();
      }
    }
  }

  @Patch('records/:id/feedback')
  @ApiOperation({ summary: '更新 QA 反馈' })
  @RequirePermission('admin:qa-ops:write')
  async updateFeedback(@Param('id') id: string, @Body() body: { feedback: string }) {
    return { success: true, id, feedback: body.feedback };
  }

  private getUserId(req: Request) {
    const user = (req as Request & { user?: { userId?: string; sub?: string } })
      .user;
    return user?.userId ?? user?.sub ?? 'admin-backend';
  }

  private parseModel(model?: string): 'qwen' | 'deepseek' {
    if (!model) return 'qwen';
    if (model === 'qwen' || model === 'deepseek') return model;
    return 'qwen';
  }

  /** 获取管理后台上下文用户标识用于会话隔离 */
  private getAdminUserId(): string {
    return 'admin-backend';
  }

  private writeAguiFallback(res: Response, message: string) {
    const runId = 'admin-proxy';
    const timestamp = new Date().toISOString();
    const write = (type: string, data?: Record<string, unknown>) => {
      res.write(
        `data: ${JSON.stringify({
          type,
          runId,
          timestamp,
          data,
        })}\n\n`,
      );
    };

    write('RUN_STARTED', {
      input: { mode: 'proxy-fallback' },
    });
    write('TEXT_MESSAGE_START', {
      messageId: 'admin-proxy-message',
      role: 'assistant',
    });
    write('TEXT_MESSAGE_CONTENT', {
      messageId: 'admin-proxy-message',
      delta: message,
    });
    write('TEXT_MESSAGE_END', {
      messageId: 'admin-proxy-message',
    });
    write('RUN_FINISHED', {
      output: {
        answer: message,
        references: [],
        retrievalSufficient: false,
        retrievalReason: '管理后台未连接到 RAG 后端，已返回代理层友好兜底提示',
        route: 'proxy-fallback',
      },
    });
  }

  private toFriendlyProxyMessage(message: string) {
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(message)) {
      return '当前管理后台还没有连上 RAG 后端服务，所以这次问答没有进入模型生成链路。请先启动 rag-backend，并确认 admin-backend 的 RAG_SERVICE_BASE_URL 指向它。';
    }

    if (/401|unauthorized|invalid authentication/i.test(message)) {
      return '当前管理后台调用 RAG 后端的内部服务 token 校验失败。请确认 admin-backend 和 rag-backend 使用同一个 RAG_SERVICE_TOKEN。';
    }

    return `当前管理后台调用 RAG 后端失败：${message}。请检查 rag-backend 服务状态、RAG_SERVICE_BASE_URL 和 RAG_SERVICE_TOKEN。`;
  }

  @Get('negative-feedback')
  @ApiOperation({ summary: '差评样本' })
  @RequirePermission('admin:qa-ops:read')
  async getNegativeFeedback() {
    return this.ragClient.getQaNegativeFeedback();
  }

  @Get('citation-failures')
  @ApiOperation({ summary: '引用失败样本' })
  @RequirePermission('admin:qa-ops:read')
  async getCitationFailures() {
    return this.ragClient.getQaCitationFailures();
  }

  @Get('cost-summary')
  @ApiOperation({ summary: '成本统计' })
  @RequirePermission('admin:qa-ops:read')
  async getCostSummary() {
    return this.ragClient.getQaCostSummary();
  }
}
