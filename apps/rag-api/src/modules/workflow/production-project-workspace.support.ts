import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import JSZip from 'jszip';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { RedisProvider } from '../../providers/redis/redis.provider';
import {
  WorkspacePreviewRequest,
  WorkspaceStatus,
} from './production-project-workspace.dto';
import {
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_PROXY_RESPONSE_BYTES,
  MAX_SEED_FILES,
  MAX_SEED_UNCOMPRESSED_BYTES,
  MAX_SINGLE_FILE_BYTES,
  WORKSPACE_ROOT,
  WORKSPACE_LOCK_RETRY_MS,
  WORKSPACE_LOCK_TTL_SECONDS,
  WORKSPACE_LOCK_WAIT_MS,
  WORKSPACE_TASK_LEASE_RENEW_INTERVAL_MS,
  WORKSPACE_TASK_LEASE_TTL_SECONDS,
  type SandboxCommandOutput,
  type WorkspaceRecord,
} from './production-project-workspace.shared';

interface WorkspaceTaskLeaseContext {
  workspaceKey: string;
  leaseKey: string;
  fencingKey: string;
  token: string;
  fencingToken: number;
  lost: boolean;
  abortController: AbortController;
}

export class WorkspaceTaskLeaseLostError extends Error {
  constructor() {
    super('Workspace task lease was lost.');
    this.name = 'WorkspaceTaskLeaseLostError';
  }
}

export abstract class ProductionProjectWorkspaceSupport {
  protected abstract readonly config: ConfigService;
  protected abstract readonly redis: RedisProvider;
  protected abstract readonly artifacts: ArtifactsService;
  private readonly taskLeaseContext =
    new AsyncLocalStorage<WorkspaceTaskLeaseContext>();

  async withWorkspaceTaskLease<T>(
    threadId: string,
    userId: string,
    tenantId: string | undefined,
    callback: () => Promise<T>,
  ): Promise<T> {
    this.assertIdentity(threadId, userId);
    const workspaceKey = this.workspaceKey(threadId, userId, tenantId);
    const existing = this.taskLeaseContext.getStore();
    if (existing) {
      if (existing.workspaceKey !== workspaceKey) {
        throw new ConflictException(
          'A task cannot hold workspace leases for multiple workspaces.',
        );
      }
      await this.assertWorkspaceTaskLease();
      return callback();
    }

    this.assertRedis();
    const leaseKey = `${workspaceKey}:task-execution-lease`;
    const token = randomUUID();
    while (
      !(await this.redis.setIfAbsentRequired(
        leaseKey,
        token,
        WORKSPACE_TASK_LEASE_TTL_SECONDS,
      ))
    ) {
      await this.wait(WORKSPACE_LOCK_RETRY_MS);
    }

    const fencingKey = `${workspaceKey}:task-execution-fence`;
    let fencingToken: number;
    try {
      fencingToken = await this.redis.incrementRequired(fencingKey);
    } catch (error) {
      await this.redis.releaseLock(leaseKey, token);
      throw error;
    }

    const context: WorkspaceTaskLeaseContext = {
      workspaceKey,
      leaseKey,
      fencingKey,
      token,
      fencingToken,
      lost: false,
      abortController: new AbortController(),
    };
    const renewal = setInterval(() => {
      void this.redis
        .renewLock(leaseKey, token, WORKSPACE_TASK_LEASE_TTL_SECONDS)
        .then((renewed) => {
          if (!renewed) this.loseWorkspaceTaskLease(context);
        })
        .catch(() => this.loseWorkspaceTaskLease(context));
    }, WORKSPACE_TASK_LEASE_RENEW_INTERVAL_MS);

    try {
      return await this.taskLeaseContext.run(context, async () => {
        await this.assertWorkspaceTaskLease();
        const result = await callback();
        await this.assertWorkspaceTaskLease();
        return result;
      });
    } finally {
      clearInterval(renewal);
      await this.redis.releaseLock(leaseKey, token);
    }
  }

  isWorkspaceTaskLeaseActive(
    threadId: string,
    userId: string,
    tenantId?: string,
  ): boolean {
    return (
      this.taskLeaseContext.getStore()?.workspaceKey ===
      this.workspaceKey(threadId, userId, tenantId)
    );
  }

  protected hasWorkspaceTaskLease(
    threadId: string,
    userId: string,
    tenantId?: string,
  ): boolean {
    return this.isWorkspaceTaskLeaseActive(threadId, userId, tenantId);
  }

  protected workspaceTaskLeaseSignal(): AbortSignal | undefined {
    return this.taskLeaseContext.getStore()?.abortController.signal;
  }

  async assertWorkspaceTaskLeaseOwned(): Promise<void> {
    const context = this.taskLeaseContext.getStore();
    if (!context) return;
    if (context.lost) {
      throw new WorkspaceTaskLeaseLostError();
    }
    let current: string | null;
    let currentFence: string | null;
    try {
      [current, currentFence] = await Promise.all([
        this.redis.getRequired(context.leaseKey),
        this.redis.getRequired(context.fencingKey),
      ]);
    } catch {
      this.loseWorkspaceTaskLease(context);
      throw new WorkspaceTaskLeaseLostError();
    }
    if (
      current !== context.token ||
      Number(currentFence) !== context.fencingToken
    ) {
      this.loseWorkspaceTaskLease(context);
      throw new WorkspaceTaskLeaseLostError();
    }
  }

  protected assertWorkspaceTaskLease(): Promise<void> {
    return this.assertWorkspaceTaskLeaseOwned();
  }

  private loseWorkspaceTaskLease(context: WorkspaceTaskLeaseContext): void {
    context.lost = true;
    context.abortController.abort();
  }

  protected async unpackSeedZip(body: Buffer) {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(body, { checkCRC32: true });
    } catch {
      throw new BadRequestException('Artifact is not a valid ZIP archive.');
    }
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    if (entries.length > MAX_SEED_FILES) {
      throw new BadRequestException('Code ZIP contains too many files.');
    }
    const output: Array<{ path: string; data: Uint8Array }> = [];
    const paths = new Set<string>();
    let totalBytes = 0;
    for (const entry of entries) {
      if (
        entry.unsafeOriginalName &&
        this.normalizeArchivePath(entry.unsafeOriginalName) !== entry.name
      ) {
        throw new BadRequestException('Code ZIP contains an unsafe path.');
      }
      const relativePath = this.normalizeArchivePath(entry.name);
      if (!relativePath)
        throw new BadRequestException('Code ZIP contains an unsafe path.');
      if (paths.has(relativePath)) {
        throw new BadRequestException('Code ZIP contains duplicate paths.');
      }
      paths.add(relativePath);
      const uncompressedSize = (
        entry as JSZip.JSZipObject & {
          _data?: { uncompressedSize?: number };
        }
      )._data?.uncompressedSize;
      if (
        typeof uncompressedSize !== 'number' ||
        uncompressedSize > MAX_SINGLE_FILE_BYTES
      ) {
        throw new BadRequestException('Code ZIP contains an oversized file.');
      }
      totalBytes += uncompressedSize;
      if (totalBytes > MAX_SEED_UNCOMPRESSED_BYTES) {
        throw new BadRequestException(
          'Code ZIP exceeds the uncompressed size limit.',
        );
      }
      const data = await entry.async('uint8array');
      if (data.length !== uncompressedSize) {
        throw new BadRequestException(
          'Code ZIP contains an invalid file entry.',
        );
      }
      output.push({ path: `${WORKSPACE_ROOT}/${relativePath}`, data });
    }
    return output;
  }

  protected normalizeArchivePath(value: string): string | null {
    if (
      !value ||
      value.startsWith('/') ||
      value.includes('\\') ||
      value.includes('\0')
    ) {
      return null;
    }
    const parts = value.split('/').filter(Boolean);
    if (!parts.length || parts.some((part) => part === '.' || part === '..'))
      return null;
    return parts.join('/');
  }

  protected validateCommand(command: string, maxLength: number): string {
    if (
      typeof command !== 'string' ||
      !command.trim() ||
      command.length > maxLength
    ) {
      throw new BadRequestException(
        `command must contain 1 to ${maxLength} characters.`,
      );
    }
    if (command.includes('\0'))
      throw new BadRequestException('command contains an invalid character.');
    return command;
  }

  protected validateTimeout(timeoutSeconds: number): number {
    if (
      !Number.isInteger(timeoutSeconds) ||
      timeoutSeconds < 1 ||
      timeoutSeconds > 240
    ) {
      throw new BadRequestException(
        'timeoutSeconds must be an integer from 1 to 240.',
      );
    }
    return timeoutSeconds;
  }

  protected commandOutput(execution: SandboxCommandOutput): string {
    return this.truncateOutput(this.commandOutputContent(execution));
  }

  protected commandOutputWasTruncated(
    execution: SandboxCommandOutput,
  ): boolean {
    return (
      Buffer.byteLength(this.commandOutputContent(execution)) >
      MAX_COMMAND_OUTPUT_BYTES
    );
  }

  private commandOutputContent(execution: SandboxCommandOutput): string {
    const chunks = [
      ...(execution.logs?.stdout ?? []).map((entry) => entry.text ?? ''),
      ...(execution.logs?.stderr ?? []).map((entry) => entry.text ?? ''),
      execution.error?.value ?? '',
    ];
    return chunks.filter(Boolean).join('');
  }

  protected truncateOutput(output: string): string {
    const bytes = Buffer.from(output);
    if (bytes.length <= MAX_COMMAND_OUTPUT_BYTES) return output;
    const marker = '\n[output truncated]';
    const limit = MAX_COMMAND_OUTPUT_BYTES - Buffer.byteLength(marker);
    return `${bytes.subarray(bytes.length - limit).toString()}${marker}`;
  }

  protected validatePreviewPath(input: string): string {
    if (
      typeof input !== 'string' ||
      input.length > 2048 ||
      input.includes('\\')
    ) {
      throw new BadRequestException('Preview path is invalid.');
    }
    let decoded = input;
    try {
      for (let round = 0; round < 8; round += 1) {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
        if (round === 7 && /%(?:2e|2f|5c)/i.test(decoded)) {
          throw new Error('over-encoded preview path');
        }
      }
    } catch {
      throw new BadRequestException('Preview path is invalid.');
    }
    if (
      decoded.startsWith('/') ||
      decoded.includes('\\') ||
      decoded.includes('\0') ||
      decoded.split('/').some((segment) => segment === '..') ||
      /^[a-z][a-z0-9+.-]*:/i.test(decoded)
    ) {
      throw new BadRequestException('Preview path is invalid.');
    }
    return decoded
      .split('/')
      .filter((segment) => segment && segment !== '.')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  protected buildEndpointUrl(endpointUrl: string, path: string): URL {
    const protocol = this.sandboxProtocol();
    if (
      !endpointUrl ||
      endpointUrl.includes('@') ||
      endpointUrl.includes('#')
    ) {
      throw new BadGatewayException(
        'OpenSandbox returned an invalid endpoint.',
      );
    }
    let url: URL;
    try {
      url = new URL(endpointUrl);
    } catch {
      throw new BadGatewayException(
        'OpenSandbox returned an invalid endpoint.',
      );
    }
    if (
      url.protocol !== `${protocol}:` ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new BadGatewayException(
        'OpenSandbox returned an invalid endpoint.',
      );
    }
    const endpointPath = url.pathname.replace(/\/+$/, '');
    url.pathname = `${endpointPath}/${path}`.replace(/\/{2,}/g, '/');
    return url;
  }

  protected previewRequestHeaders(
    input: WorkspacePreviewRequest['headers'],
    endpointHeaders?: Record<string, string>,
  ): Headers {
    const headers = new Headers(endpointHeaders ?? {});
    const allowed = new Set([
      'accept',
      'accept-language',
      'if-none-match',
      'if-modified-since',
      'range',
    ]);
    for (const [name, value] of Object.entries(input ?? {})) {
      if (allowed.has(name.toLowerCase()) && typeof value === 'string') {
        headers.set(name, value);
      }
    }
    headers.delete('host');
    headers.delete('connection');
    headers.delete('content-length');
    return headers;
  }

  protected previewResponseHeaders(
    headers: Headers,
    bodyLength: number,
  ): Record<string, string> {
    const allowed = [
      'content-type',
      'cache-control',
      'etag',
      'last-modified',
      'content-language',
      'content-disposition',
    ];
    const result: Record<string, string> = {
      'content-length': String(bodyLength),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy':
        'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads',
    };
    for (const name of allowed) {
      const value = headers.get(name);
      if (value) result[name] = value;
    }
    return result;
  }

  protected async readResponseBody(
    response: Response,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const cancelReader = () => {
      void reader.cancel(signal?.reason).catch(() => undefined);
    };
    if (signal?.aborted) cancelReader();
    else signal?.addEventListener('abort', cancelReader, { once: true });
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        totalBytes += chunk.length;
        if (totalBytes > MAX_PROXY_RESPONSE_BYTES) {
          await reader.cancel();
          throw new BadGatewayException(
            'Preview response exceeds the size limit.',
          );
        }
        chunks.push(chunk);
      }
      if (signal?.aborted) {
        throw new BadGatewayException('Preview request was cancelled.');
      }
    } finally {
      signal?.removeEventListener('abort', cancelReader);
    }
    return Buffer.concat(chunks, totalBytes);
  }

  protected serializeQuery(query: WorkspacePreviewRequest['query']): string {
    if (!query) return '';
    if (typeof query === 'string') {
      if (query.length > 4096 || /[\r\n]/.test(query)) {
        throw new BadRequestException('Preview query is invalid.');
      }
      return query.startsWith('?') ? query.slice(1) : query;
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key.length > 256 || /[\r\n]/.test(key)) {
        throw new BadRequestException('Preview query is invalid.');
      }
      for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof item === 'string') {
          if (item.length > 2048 || /[\r\n]/.test(item)) {
            throw new BadRequestException('Preview query is invalid.');
          }
          params.append(key, item);
        }
      }
    }
    return params.toString();
  }

  protected workspaceRelativePath(path: string): string | null {
    const prefix = `${WORKSPACE_ROOT}/`;
    if (!path.startsWith(prefix)) return null;
    const relative = path.slice(prefix.length);
    return this.normalizeArchivePath(relative);
  }

  protected workspaceKey(
    threadId: string,
    userId: string,
    tenantId?: string,
  ): string {
    const identity = JSON.stringify([tenantId ?? null, userId, threadId]);
    return `workspace:project:v1:${this.hash(identity)}`;
  }

  protected async withWorkspaceLock<T>(
    workspaceKey: string,
    operation: 'start' | 'dev-server',
    callback: () => Promise<T>,
  ): Promise<T> {
    this.assertRedis();
    const lockKey = `${workspaceKey}:lock:${operation}`;
    const lockValue = randomBytes(16).toString('hex');
    const deadline = Date.now() + WORKSPACE_LOCK_WAIT_MS;
    let acquired = false;
    try {
      while (Date.now() < deadline) {
        try {
          acquired = await this.redis.setIfAbsentRequired(
            lockKey,
            lockValue,
            WORKSPACE_LOCK_TTL_SECONDS,
          );
        } catch {
          throw new ServiceUnavailableException(
            'Workspace lock storage is unavailable.',
          );
        }
        if (acquired) return await callback();
        await this.wait(WORKSPACE_LOCK_RETRY_MS);
      }
      throw new ConflictException(
        'A workspace operation is already in progress. Retry shortly.',
      );
    } finally {
      if (acquired) await this.redis.releaseLock(lockKey, lockValue);
    }
  }

  protected previewKey(ticket: string): string {
    return `workspace:preview:v1:${this.hash(ticket)}`;
  }

  protected hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  protected assertIdentity(threadId: string, userId: string): void {
    if (
      typeof threadId !== 'string' ||
      !threadId.trim() ||
      threadId.length > 128 ||
      typeof userId !== 'string' ||
      !userId.trim() ||
      userId.length > 128
    ) {
      throw new BadRequestException('Workspace identity is invalid.');
    }
  }

  protected assertArtifactTenant(
    artifact: { tenantId?: string | null },
    tenantId?: string,
  ): void {
    if (artifact.tenantId !== (tenantId ?? null)) {
      throw new ForbiddenException('Artifact does not belong to this tenant.');
    }
  }

  protected toStatus(record: WorkspaceRecord, ready = true): WorkspaceStatus {
    return {
      ready,
      projectRoot: ready ? WORKSPACE_ROOT : null,
      active: true,
      artifactId: record.artifactId,
      createdAt: record.createdAt,
      ...(record.devServer
        ? {
            devServer: {
              port: record.devServer.port,
              commandId: record.devServer.commandId,
              startedAt: record.devServer.startedAt,
            },
          }
        : {}),
    };
  }

  protected async wait(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  protected sandboxProtocol(): 'http' | 'https' {
    const domain = this.config.get<string>('opensandbox.domain')?.trim() ?? '';
    const configured = this.config.get<string>('opensandbox.protocol');
    const domainProtocol = /^https:\/\//i.test(domain)
      ? 'https'
      : /^http:\/\//i.test(domain)
        ? 'http'
        : undefined;
    const protocol = domainProtocol ?? configured ?? 'http';
    if (protocol !== 'http' && protocol !== 'https') {
      throw new ServiceUnavailableException('OpenSandbox is not configured.');
    }
    return protocol;
  }

  protected assertRedis(): void {
    if (!this.redis.isEnabled()) {
      throw new ServiceUnavailableException(
        'Workspace state storage is unavailable.',
      );
    }
  }
}
