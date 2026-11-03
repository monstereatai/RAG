import { Injectable } from "@nestjs/common";
import { once } from "node:events";
import type { Response } from "express";
import { RagClientService } from "../rag-client/rag-client.service";
import type { RagAguiStreamQuery } from "../rag-client/rag-client.types";

@Injectable()
export class QaOpsAguiStreamProxyService {
  constructor(private readonly ragClient: RagClientService) {}

  async proxy(
    query: RagAguiStreamQuery,
    res: Response,
    traceparent?: string,
    requestId?: string,
  ): Promise<void> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let readerCancelPromise: Promise<void> | undefined;
    const cancelReader = () => {
      if (!reader) return Promise.resolve();
      readerCancelPromise ??= reader.cancel().then(
        () => undefined,
        () => undefined,
      );
      return readerCancelPromise;
    };
    const abortUpstreamOnDisconnect = () => {
      if (!res.writableEnded) {
        controller.abort();
        void cancelReader();
      }
    };
    res.on("close", abortUpstreamOnDisconnect);

    try {
      const upstream = await this.ragClient.streamAgui(
        query,
        controller.signal,
        traceparent,
        requestId,
      );

      if (!upstream.ok || !upstream.body) {
        this.writeAguiFallback(
          res,
          this.toFriendlyProxyMessage(`rag service returned ${upstream.status}`),
        );
        res.end();
        return;
      }

      reader = upstream.body.getReader();
      if (controller.signal.aborted) await cancelReader();
      try {
        while (
          !controller.signal.aborted &&
          !res.destroyed &&
          !res.writableEnded
        ) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            return;
          }
          // 浏览器接收较慢时暂停读取上游，避免 SSE 数据在 Admin API 内存中不断堆积。
          if (!res.write(Buffer.from(value))) {
            await once(res, "drain", { signal: controller.signal });
          }
        }
      } finally {
        if (controller.signal.aborted) await cancelReader();
      }
    } catch (error) {
      if (!res.destroyed && !res.writableEnded) {
        this.writeAguiFallback(
          res,
          this.toFriendlyProxyMessage(
            error instanceof Error ? error.message : "rag stream proxy failed",
          ),
        );
        res.end();
      }
    } finally {
      res.off("close", abortUpstreamOnDisconnect);
    }
  }

  private writeAguiFallback(res: Response, message: string) {
    const runId = "admin-proxy";
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

    write("RUN_STARTED", {
      input: { mode: "proxy-fallback" },
    });
    write("TEXT_MESSAGE_START", {
      messageId: "admin-proxy-message",
      role: "assistant",
    });
    write("TEXT_MESSAGE_CONTENT", {
      messageId: "admin-proxy-message",
      delta: message,
    });
    write("TEXT_MESSAGE_END", {
      messageId: "admin-proxy-message",
    });
    write("RUN_FINISHED", {
      output: {
        answer: message,
        references: [],
        retrievalSufficient: false,
        retrievalReason: "管理后台未连接到 RAG 后端，已返回代理层友好兜底提示",
        route: "proxy-fallback",
      },
    });
  }

  private toFriendlyProxyMessage(message: string) {
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(message)) {
      return "当前管理后台还没有连上 RAG 后端服务，所以这次问答没有进入模型生成链路。请先启动 rag-backend，并确认 admin-backend 的 RAG_SERVICE_BASE_URL 指向它。";
    }

    if (/401|unauthorized|invalid authentication/i.test(message)) {
      return "当前管理后台调用 RAG 后端的内部服务 token 校验失败。请确认 admin-backend 和 rag-backend 使用同一个 RAG_SERVICE_TOKEN。";
    }

    return `当前管理后台调用 RAG 后端失败：${message}。请检查 rag-backend 服务状态、RAG_SERVICE_BASE_URL 和 RAG_SERVICE_TOKEN。`;
  }
}
