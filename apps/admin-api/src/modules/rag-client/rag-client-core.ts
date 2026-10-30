import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { RagClientResult } from "./dto/rag-admin.dto";
import { resolveRagServiceToken } from "./rag-service-token";

export abstract class RagClientCoreBase {
  protected readonly baseUrl: string;

  protected readonly timeoutMs: number;

  protected readonly serviceToken: string;

  constructor(configService: ConfigService) {
    this.baseUrl = (
      configService.get<string>("RAG_SERVICE_BASE_URL") ||
      process.env.RAG_SERVICE_BASE_URL ||
      "http://localhost:3000/api/v1"
    ).replace(/\/$/, "");
    this.timeoutMs = Number(
      configService.get<string>("RAG_SERVICE_TIMEOUT_MS") ||
        process.env.RAG_SERVICE_TIMEOUT_MS ||
        2000
    );
    this.serviceToken = resolveRagServiceToken(configService);
  }

  getConfig() {
    return {
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      integration: "http-api-contract",
      sharedPackage: false,
    };
  }

  protected mapAdminUserId(
    userId: string | number | undefined,
  ): string | undefined {
    const normalized =
      typeof userId === 'number' && Number.isSafeInteger(userId)
        ? String(userId)
        : typeof userId === 'string'
          ? userId.trim()
          : undefined;
    // Admin Backend's user table has numeric IDs. Preserve nonnumeric RAG,
    // integration, and service identities such as "admin-backend".
    if (!normalized || !/^\d+$/.test(normalized)) {
      return typeof userId === 'string' ? userId : undefined;
    }
    const digest = createHash("sha256")
      .update("rag-admin-user\0")
      .update(normalized)
      .digest("hex")
      .slice(0, 58);
    return `admin:${digest}`;
  }

  protected mapAdminActorField(body: unknown, field: string): unknown {
    if (!body || typeof body !== "object" || Array.isArray(body)) return body;
    const payload = body as Record<string, unknown>;
    const value = payload[field];
    if (
      (typeof value !== "string" || !value.trim()) &&
      !(typeof value === "number" && Number.isSafeInteger(value))
    ) {
      return body;
    }
    return { ...payload, [field]: this.mapAdminUserId(value) };
  }

  async getJson<T>(
    path: string,
    timeoutMs = this.timeoutMs,
  ): Promise<RagClientResult<T>> {
    return this.request<T>(path, { method: "GET" }, true, timeoutMs);
  }

  protected async postJson<T>(
    path: string,
    body: unknown
  ): Promise<RagClientResult<T>> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  protected async patchJson<T>(
    path: string,
    body: unknown
  ): Promise<RagClientResult<T>> {
    return this.request<T>(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  protected async deleteJson<T>(path: string): Promise<RagClientResult<T>> {
    return this.request<T>(path, { method: "DELETE" });
  }

  protected async request<T>(
    path: string,
    init: RequestInit,
    authenticated = true,
    timeoutMs = this.timeoutMs,
  ): Promise<RagClientResult<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
    };
    if (authenticated && this.serviceToken) {
      headers["Authorization"] = `Bearer ${this.serviceToken}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;

      return {
        available: response.ok,
        status: response.status,
        data: response.ok ? data : null,
        error: response.ok
          ? undefined
          : this.extractError(data, response.status),
      };
    } catch (error) {
      return {
        available: false,
        status: null,
        data: null,
        error:
          error instanceof Error ? error.message : "rag service request failed",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  protected async requestRaw(
    path: string,
    authenticated: boolean,
    extraHeaders: Record<string, string> = {},
    method = 'GET',
    body?: string,
    timeoutMs = this.timeoutMs,
    signal?: AbortSignal,
  ): Promise<Response> {
    const controller = signal ? undefined : new AbortController();
    const timeout = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
    const headers = { ...extraHeaders };
    if (authenticated && this.serviceToken) {
      headers["Authorization"] = `Bearer ${this.serviceToken}`;
    }
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: signal ?? controller?.signal,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  protected toQueryString(query: object): string {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(
      query as Record<string, unknown>
    )) {
      if (
        value !== undefined &&
        value !== null &&
        value !== "" &&
        key !== "current"
      ) {
        params.set(key, String(value));
      }
    }

    const text = params.toString();
    return text ? `?${text}` : "";
  }

  protected extractError(data: unknown, status: number): string {
    if (data && typeof data === "object" && "message" in data) {
      return String((data as { message: unknown }).message);
    }

    return `rag service returned ${status}`;
  }
}
