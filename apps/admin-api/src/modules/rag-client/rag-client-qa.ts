import { RagClientDocumentsBase } from './rag-client-documents';
import type { RagAguiStreamQuery } from './rag-client.types';

export abstract class RagClientQaBase extends RagClientDocumentsBase {
  // 建立服务端到服务端的 SSE 请求：传递映射后的管理员身份，RAG 服务令牌只留在后端。
  streamAgui(query: RagAguiStreamQuery, signal: AbortSignal) {
    const params = new URLSearchParams({
      query: query.query,
      mode: query.mode ?? "agentic",
      model: query.model ?? "qwen",
      userId: this.mapAdminUserId(query.userId) || "",
    });
    if (query.threadId) {
      params.set("threadId", query.threadId);
    }
    if (query.rolePresetId) {
      params.set("rolePresetId", query.rolePresetId);
    }
    if (query.pluginKeys?.length) {
      params.set("pluginKeys", query.pluginKeys.join(","));
    }
    if (query.attachmentIds?.length) {
      params.set("attachmentIds", query.attachmentIds.join(","));
    }
    const headers: Record<string, string> = {};
    if (this.serviceToken) {
      headers.Authorization = `Bearer ${this.serviceToken}`;
    }
    return fetch(`${this.baseUrl}/agui/admin/stream?${params.toString()}`, {
      headers,
      signal,
    });
  }

  uploadQaConversationAttachment(
    file: Express.Multer.File,
    userId: string,
    threadId: string,
  ) {
    const formData = new FormData();
    const fileBytes = new Uint8Array(file.buffer.byteLength);
    fileBytes.set(file.buffer);
    formData.append(
      "file",
      new Blob([fileBytes.buffer], { type: file.mimetype }),
      file.originalname,
    );
    formData.append("userId", this.mapAdminUserId(userId) ?? userId);
    formData.append("threadId", threadId);
    return this.request<Record<string, unknown>>(
      "/agui/admin/attachments",
      { method: "POST", body: formData },
      true,
      120_000,
    );
  }

  listQaConversationAttachments(userId: string, threadId: string) {
    return this.getJson<Record<string, unknown>[]>(
      `/agui/admin/attachments${this.toQueryString({ userId: this.mapAdminUserId(userId), threadId })}`,
    );
  }

  deleteQaConversationAttachment(
    attachmentId: string,
    userId: string,
    threadId: string,
  ) {
    return this.deleteJson<Record<string, unknown>>(
      `/agui/admin/attachments/${encodeURIComponent(attachmentId)}${this.toQueryString({ userId: this.mapAdminUserId(userId), threadId })}`,
    );
  }

  deleteQaConversationAttachments(userId: string, threadId: string) {
    return this.deleteJson<Record<string, unknown>>(
      `/agui/admin/attachments${this.toQueryString({ userId: this.mapAdminUserId(userId), threadId })}`,
    );
  }
}
