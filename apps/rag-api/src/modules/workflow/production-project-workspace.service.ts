import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import JSZip from 'jszip';
import { Sandbox, SandboxApiException } from '@alibaba-group/opensandbox';
import { createHash, randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { ProductionWorkflowService } from './production-workflow.service';
import {
  StartDevServerInput,
  WorkspaceCommandResult,
  WorkspaceDevServerStatus,
  WorkspacePreviewRequest,
  WorkspacePreviewTicket,
  WorkspaceProxyResponse,
  WorkspaceStatus,
} from './production-project-workspace.dto';

const WORKSPACE_ROOT = '/root/workspace';
const WORKSPACE_TTL_SECONDS = 6 * 60 * 60;
const PREVIEW_TICKET_TTL_SECONDS = 5 * 60;
const MAX_COMMAND_LENGTH = 4096;
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024;
const MAX_DEV_COMMAND_LENGTH = 1024;
const MAX_SEED_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_SEED_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_SEED_FILES = 1500;
const MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_EXPORT_BYTES = 100 * 1024 * 1024;
const MAX_PROXY_RESPONSE_BYTES = 25 * 1024 * 1024;
const DEV_SERVER_READY_TIMEOUT_MS = 20_000;
const DEV_SERVER_READY_INTERVAL_MS = 500;
const WORKSPACE_LOCK_TTL_SECONDS = 300;
const WORKSPACE_LOCK_WAIT_MS = 30_000;
const WORKSPACE_LOCK_RETRY_MS = 100;
const PREVIEW_UPSTREAM_TIMEOUT_MS = 45_000;

interface WorkspaceRecord {
  version: 1;
  tenantId: string | null;
  ownerUserId: string;
  threadId: string;
  sandboxId: string;
  artifactId: string;
  createdAt: string;
  expiresAt: number;
  devServer: null | {
    commandId: string;
    port: number;
    startedAt: string;
  };
}

interface PreviewTicketRecord {
  version: 1;
  workspaceKey: string;
  tenantId: string | null;
  ownerUserId: string;
  threadId: string;
  sandboxId: string;
  port: number;
  expiresAt: number;
}

interface SandboxCommandOutput {
  logs?: {
    stdout?: Array<{ text?: string }>;
    stderr?: Array<{ text?: string }>;
  };
  error?: { value?: string };
  exitCode?: number | null;
  id?: string;
}

@Injectable()
export class ProductionProjectWorkspaceService {
  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisProvider,
    private readonly workflow: ProductionWorkflowService,
    private readonly artifacts: ArtifactsService,
  ) {}

  async getStatus(
    threadId: string,
    userId: string,
    tenantId?: string,
  ): Promise<WorkspaceStatus> {
    this.assertIdentity(threadId, userId);
    const key = this.workspaceKey(threadId, userId, tenantId);
    const record = await this.readWorkspace(key, threadId, userId, tenantId);
    if (!record) return { ready: false, projectRoot: null, active: false };
    if (record.expiresAt <= Date.now()) {
      return { ...this.toStatus(record, false), expired: true };
    }
    try {
      const sandbox = await this.connectSandbox(record.sandboxId);
      await sandbox.close();
      return this.toStatus(record, true);
    } catch {
      return this.toStatus(record, false);
    }
  }

  async startWorkspace(
    threadId: string,
    userId: string,
    tenantId: string | undefined,
    artifactId: string,
  ): Promise<WorkspaceStatus> {
    this.assertIdentity(threadId, userId);
    if (!artifactId || artifactId.length > 64) {
      throw new BadRequestException('artifactId is invalid.');
    }
    await this.workflow.codingContext(threadId, userId, tenantId);
    const artifact = await this.artifacts.getStudioVersion(
      artifactId,
      userId,
      threadId,
    );
    this.assertArtifactTenant(artifact, tenantId);
    if (
      artifact.status !== 'ready' ||
      artifact.kind !== 'code' ||
      !artifact.filename.toLowerCase().endsWith('.zip')
    ) {
      throw new BadRequestException(
        'Workspace requires a ready generated code ZIP artifact.',
      );
    }

    const key = this.workspaceKey(threadId, userId, tenantId);
    return this.withWorkspaceLock(key, 'start', async () => {
      const existing = await this.readWorkspace(
        key,
        threadId,
        userId,
        tenantId,
      );
      if (existing) {
        if (existing.artifactId !== artifactId) {
          throw new ConflictException(
            '先导出当前工作区 ZIP，再显式销毁后切换产物。',
          );
        }
        if (existing.expiresAt <= Date.now()) {
          throw new ConflictException(
            'Workspace has expired. Export it if available, then explicitly destroy it before restarting.',
          );
        }
        const sandbox = await this.connectSandbox(existing.sandboxId);
        await sandbox.close();
        return this.toStatus(existing);
      }

      const archive = await this.artifacts.getStudioVersionFile(
        artifactId,
        userId,
        threadId,
      );
      if (archive.body.length > MAX_SEED_ZIP_BYTES) {
        throw new BadRequestException('Code ZIP exceeds the allowed size.');
      }
      const files = await this.unpackSeedZip(archive.body);
      const sandbox = await this.createSandbox(threadId, userId, tenantId);
      try {
        await sandbox.files.createDirectories([{ path: WORKSPACE_ROOT }]);
        if (files.length) await sandbox.files.writeFiles(files);
        const record: WorkspaceRecord = {
          version: 1,
          tenantId: tenantId ?? null,
          ownerUserId: userId,
          threadId,
          sandboxId: sandbox.id,
          artifactId,
          createdAt: new Date().toISOString(),
          expiresAt: Date.now() + WORKSPACE_TTL_SECONDS * 1000,
          devServer: null,
        };
        await this.saveWorkspace(key, record);
        return this.toStatus(record);
      } catch (error) {
        try {
          await sandbox.kill();
        } finally {
          await sandbox.close();
        }
        throw error;
      }
    });
  }

  async runCommand(
    threadId: string,
    userId: string,
    tenantId: string | undefined,
    command: string,
    timeoutSeconds = 120,
    signal?: AbortSignal,
  ): Promise<WorkspaceCommandResult> {
    this.assertIdentity(threadId, userId);
    const normalizedCommand = this.validateCommand(command, MAX_COMMAND_LENGTH);
    const boundedTimeout = this.validateTimeout(timeoutSeconds);
    const { sandbox } = await this.getActiveWorkspace(
      threadId,
      userId,
      tenantId,
    );
    const startedAt = Date.now();
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, boundedTimeout * 1000);
    let execution: SandboxCommandOutput | undefined;
    let streamedOutput = '';
    const appendOutput = (text: string) => {
      streamedOutput = Buffer.concat([
        Buffer.from(streamedOutput),
        Buffer.from(text),
      ])
        .subarray(-MAX_COMMAND_OUTPUT_BYTES)
        .toString();
    };
    try {
      execution = (await sandbox.commands.run(
        normalizedCommand,
        {
          workingDirectory: WORKSPACE_ROOT,
          timeoutSeconds: boundedTimeout,
        },
        {
          onStdout: (message) => appendOutput(message.text),
          onStderr: (message) => appendOutput(message.text),
          skipAccumulation: true,
        },
        controller.signal,
      )) as SandboxCommandOutput;
    } catch (error) {
      if (signal?.aborted && !timedOut) throw error;
      if (!timedOut) throw new BadGatewayException('Sandbox command failed.');
      appendOutput(`\nCommand timed out after ${boundedTimeout} seconds.`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
      await sandbox.close();
    }
    const output = execution ? this.commandOutput(execution) : streamedOutput;
    return {
      command: normalizedCommand,
      output: this.truncateOutput(output || streamedOutput),
      exitCode: execution?.exitCode ?? null,
      durationMs: Date.now() - startedAt,
      timedOut,
    };
  }

  async startDevServer(
    threadId: string,
    userId: string,
    tenantId: string | undefined,
    input: StartDevServerInput,
  ): Promise<WorkspaceDevServerStatus> {
    this.assertIdentity(threadId, userId);
    if (
      !Number.isInteger(input?.port) ||
      input.port < 1024 ||
      input.port > 65535
    ) {
      throw new BadRequestException(
        'port must be an integer from 1024 to 65535.',
      );
    }
    const command = this.validateCommand(
      input.command ?? `npm run dev -- --host 0.0.0.0 --port ${input.port}`,
      MAX_DEV_COMMAND_LENGTH,
    );
    const key = this.workspaceKey(threadId, userId, tenantId);
    return this.withWorkspaceLock(key, 'dev-server', async () => {
      const workspace = await this.getActiveWorkspace(
        threadId,
        userId,
        tenantId,
      );
      const { record, sandbox } = workspace;
      let startedCommandId: string | undefined;
      try {
        if (record.devServer) {
          const previousStatus = await sandbox.commands.getCommandStatus(
            record.devServer.commandId,
          );
          if (previousStatus.running === undefined) {
            throw new BadGatewayException(
              'Existing dev server status is unknown.',
            );
          }
          if (previousStatus.running) {
            await sandbox.commands.interrupt(record.devServer.commandId);
          }
          await this.saveWorkspace(workspace.key, {
            ...record,
            devServer: null,
          });
        }
        const execution = (await sandbox.commands.run(command, {
          workingDirectory: WORKSPACE_ROOT,
          background: true,
        })) as SandboxCommandOutput;
        if (!execution.id) {
          throw new BadGatewayException(
            'OpenSandbox did not return a background command id.',
          );
        }
        startedCommandId = execution.id;
        await this.waitForDevServerReady(sandbox, startedCommandId, input.port);
        const devServer = {
          commandId: execution.id,
          port: input.port,
          startedAt: new Date().toISOString(),
        };
        const updated = { ...record, devServer };
        await this.saveWorkspace(workspace.key, updated);
        return { status: 'running', ...devServer };
      } catch (error) {
        try {
          if (startedCommandId)
            await sandbox.commands.interrupt(startedCommandId);
        } catch {
          // Preserve the original failure; the short-lived sandbox remains the cleanup boundary.
        }
        if (error instanceof BadGatewayException) throw error;
        throw new BadGatewayException(
          'Sandbox dev server could not be started.',
        );
      } finally {
        await sandbox.close();
      }
    });
  }

  async stopDevServer(
    threadId: string,
    userId: string,
    tenantId?: string,
  ): Promise<{ stopped: boolean }> {
    this.assertIdentity(threadId, userId);
    const key = this.workspaceKey(threadId, userId, tenantId);
    return this.withWorkspaceLock(key, 'dev-server', async () => {
      const {
        key: workspaceKey,
        record,
        sandbox,
      } = await this.getActiveWorkspace(threadId, userId, tenantId);
      try {
        if (!record.devServer) return { stopped: false };
        const commandStatus = await sandbox.commands.getCommandStatus(
          record.devServer.commandId,
        );
        if (commandStatus.running === undefined) {
          throw new BadGatewayException('Dev server status is unknown.');
        }
        if (commandStatus.running) {
          await sandbox.commands.interrupt(record.devServer.commandId);
        }
        const updated = { ...record, devServer: null };
        await this.saveWorkspace(workspaceKey, updated);
        return { stopped: true };
      } catch {
        throw new BadGatewayException(
          'Sandbox dev server could not be stopped.',
        );
      } finally {
        await sandbox.close();
      }
    });
  }

  async issuePreviewTicket(
    threadId: string,
    userId: string,
    tenantId: string | undefined,
    port: number,
  ): Promise<WorkspacePreviewTicket> {
    this.assertIdentity(threadId, userId);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new BadRequestException(
        'port must be an integer from 1024 to 65535.',
      );
    }
    const {
      key: workspaceKey,
      record,
      sandbox,
    } = await this.getActiveWorkspace(threadId, userId, tenantId);
    try {
      if (!record.devServer || record.devServer.port !== port) {
        throw new ConflictException(
          'No dev server is registered on that port.',
        );
      }
      const commandStatus = await sandbox.commands.getCommandStatus(
        record.devServer.commandId,
      );
      if (!commandStatus.running) {
        throw new ConflictException('The dev server is not running.');
      }
      await sandbox.getEndpointUrl(port);
      const ticket = randomBytes(32).toString('base64url');
      const ticketRecord: PreviewTicketRecord = {
        version: 1,
        workspaceKey,
        tenantId: tenantId ?? null,
        ownerUserId: userId,
        threadId,
        sandboxId: record.sandboxId,
        port,
        expiresAt: Date.now() + PREVIEW_TICKET_TTL_SECONDS * 1000,
      };
      await this.redis.setRequiredOrThrow(
        this.previewKey(ticket),
        JSON.stringify(ticketRecord),
        PREVIEW_TICKET_TTL_SECONDS,
      );
      return { ticket, expiresInSeconds: PREVIEW_TICKET_TTL_SECONDS };
    } finally {
      await sandbox.close();
    }
  }

  async proxyPreview(
    ticket: string,
    threadId: string,
    request: WorkspacePreviewRequest,
  ): Promise<WorkspaceProxyResponse> {
    if (!ticket || !/^[A-Za-z0-9_-]{40,50}$/.test(ticket)) {
      throw new NotFoundException('Preview ticket not found.');
    }
    if (!threadId || threadId.length > 128) {
      throw new BadRequestException('threadId is invalid.');
    }
    const method = request?.method;
    if (method !== 'GET' && method !== 'HEAD') {
      throw new BadRequestException('Preview proxy accepts GET and HEAD only.');
    }
    const ticketJson = await this.readRequired(this.previewKey(ticket));
    const ticketRecord = this.parseTicket(ticketJson);
    if (
      ticketRecord.threadId !== threadId ||
      ticketRecord.expiresAt <= Date.now()
    ) {
      throw new NotFoundException('Preview ticket not found.');
    }
    const workspaceJson = await this.readRequired(ticketRecord.workspaceKey);
    const workspace = this.parseWorkspace(
      workspaceJson,
      ticketRecord.threadId,
      ticketRecord.ownerUserId,
      ticketRecord.tenantId ?? undefined,
    );
    if (
      !workspace ||
      workspace.sandboxId !== ticketRecord.sandboxId ||
      !workspace.devServer ||
      workspace.devServer.port !== ticketRecord.port
    ) {
      throw new NotFoundException('Preview ticket not found.');
    }
    const path = this.validatePreviewPath(request.path);
    const query = this.serializeQuery(request.query);
    const sandbox = await this.connectSandbox(ticketRecord.sandboxId);
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) forwardAbort();
    else
      request.signal?.addEventListener('abort', forwardAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error('Preview request timed out.')),
      PREVIEW_UPSTREAM_TIMEOUT_MS,
    );
    try {
      const endpoint = await sandbox.getEndpoint(ticketRecord.port);
      const upstreamUrl = this.buildEndpointUrl(
        await sandbox.getEndpointUrl(ticketRecord.port),
        path,
      );
      upstreamUrl.search = query;
      // Never follow redirects from untrusted code running in the sandbox.
      // This keeps the proxy bound to the SDK-issued endpoint and prevents SSRF.
      const headers = this.previewRequestHeaders(
        request.headers,
        endpoint.headers,
      );
      const response = await fetch(upstreamUrl, {
        method,
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
      const body =
        method === 'HEAD'
          ? Buffer.alloc(0)
          : await this.readResponseBody(response, controller.signal);
      return {
        status: response.status,
        headers: this.previewResponseHeaders(response.headers, body.length),
        body,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new BadGatewayException('Sandbox preview request failed.');
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', forwardAbort);
      await sandbox.close();
    }
  }

  async exportWorkspace(
    threadId: string,
    userId: string,
    tenantId?: string,
  ): Promise<Awaited<ReturnType<ArtifactsService['createStudioVersion']>>> {
    this.assertIdentity(threadId, userId);
    await this.workflow.codingContext(threadId, userId, tenantId);
    const { key, record, sandbox } = await this.getActiveWorkspace(
      threadId,
      userId,
      tenantId,
    );
    try {
      const files = await sandbox.files.listDirectory({
        path: WORKSPACE_ROOT,
        depth: 32,
      });
      if (files.length > MAX_SEED_FILES * 2) {
        throw new BadRequestException(
          'Workspace contains too many files to export.',
        );
      }
      const zip = new JSZip();
      let totalBytes = 0;
      let fileCount = 0;
      for (const file of files) {
        const relativePath = this.workspaceRelativePath(file.path);
        if (
          !relativePath ||
          file.type === 'directory' ||
          file.type === 'symlink'
        ) {
          continue;
        }
        if (file.type && file.type !== 'file') continue;
        if (
          relativePath
            .split('/')
            .some((part) => part === 'node_modules' || part === '.git')
        ) {
          continue;
        }
        if (
          typeof file.size === 'number' &&
          file.size > MAX_SINGLE_FILE_BYTES
        ) {
          throw new BadRequestException(
            'Workspace file exceeds the export size limit.',
          );
        }
        const bytes = Buffer.from(await sandbox.files.readBytes(file.path));
        totalBytes += bytes.length;
        fileCount += 1;
        if (
          bytes.length > MAX_SINGLE_FILE_BYTES ||
          totalBytes > MAX_EXPORT_BYTES ||
          fileCount > MAX_SEED_FILES
        ) {
          throw new BadRequestException(
            'Workspace exceeds the export size limit.',
          );
        }
        zip.file(relativePath, bytes);
      }
      const body = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
      });
      const version = Date.now();
      const artifact = await this.artifacts.createStudioVersion({
        ownerUserId: userId,
        tenantId,
        threadId,
        title: `工作区导出 v${version}`,
        kind: 'code',
        filename: `workspace-export-v${version}.zip`,
        sourceText: JSON.stringify({
          sourceWorkspaceArtifactId: record.artifactId,
          exportedAt: new Date().toISOString(),
          fileCount,
          framework: await this.artifactFramework(
            record.artifactId,
            userId,
            threadId,
          ),
        }),
        body,
        contentType: 'application/zip',
        metadata: {
          target: 'workspace-export',
          version,
          sourceArtifactId: record.artifactId,
          fileCount,
        },
      });
      return artifact;
    } finally {
      await sandbox.close();
    }
  }

  async destroyWorkspace(
    threadId: string,
    userId: string,
    tenantId?: string,
    confirmDiscard = false,
  ): Promise<{ destroyed: boolean }> {
    this.assertIdentity(threadId, userId);
    if (confirmDiscard !== true) {
      throw new ConflictException(
        'Explicitly confirm discarding the current workspace before destroying it.',
      );
    }
    const key = this.workspaceKey(threadId, userId, tenantId);
    const record = await this.readWorkspace(key, threadId, userId, tenantId);
    if (!record) return { destroyed: false };
    let sandbox: Sandbox;
    try {
      sandbox = await this.connectSandbox(record.sandboxId, true, true);
    } catch (error) {
      if (error instanceof SandboxApiException && error.statusCode === 404) {
        await this.redis.delRequired(key);
        return { destroyed: true };
      }
      throw error;
    }
    try {
      await sandbox.kill();
      await this.redis.delRequired(key);
      return { destroyed: true };
    } catch {
      throw new BadGatewayException(
        'Sandbox workspace could not be destroyed.',
      );
    } finally {
      await sandbox.close();
    }
  }

  private async createSandbox(
    threadId: string,
    userId: string,
    tenantId?: string,
  ): Promise<Sandbox> {
    const connectionConfig = this.connectionConfig();
    const image = this.config.get<string>('opensandbox.image');
    if (!image) {
      throw new ServiceUnavailableException(
        'OpenSandbox image is not configured.',
      );
    }
    try {
      return await Sandbox.create({
        connectionConfig,
        image,
        timeoutSeconds: WORKSPACE_TTL_SECONDS,
        readyTimeoutSeconds: 120,
        resource: {
          cpu: this.config.get<string>('opensandbox.cpuLimit') ?? '2',
          memory: this.config.get<string>('opensandbox.memoryLimit') ?? '4Gi',
        },
        networkPolicy: {
          defaultAction: 'deny',
          egress: (
            this.config.get<string[]>('opensandbox.egressAllowlist') ?? []
          ).map((target) => ({ action: 'allow' as const, target })),
        },
        metadata: {
          purpose: 'rag-project-workspace',
          thread: this.hash(threadId).slice(0, 24),
          owner: this.hash(userId).slice(0, 24),
          tenant: this.hash(tenantId ?? '').slice(0, 24),
        },
      });
    } catch {
      throw new ServiceUnavailableException(
        'OpenSandbox could not create a workspace.',
      );
    }
  }

  private async waitForDevServerReady(
    sandbox: Sandbox,
    commandId: string,
    port: number,
  ): Promise<void> {
    const deadline = Date.now() + DEV_SERVER_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      let status: { running?: boolean } | undefined;
      try {
        status = await sandbox.commands.getCommandStatus(commandId);
      } catch {
        await this.wait(DEV_SERVER_READY_INTERVAL_MS);
        continue;
      }
      if (status.running === false) {
        throw new BadGatewayException(
          'Dev server exited before becoming ready.',
        );
      }
      if (status.running === true) {
        try {
          const endpoint = await sandbox.getEndpoint(port);
          const endpointUrl = this.buildEndpointUrl(
            await sandbox.getEndpointUrl(port),
            '',
          );
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 1_000);
          try {
            await fetch(endpointUrl, {
              method: 'HEAD',
              headers: new Headers(endpoint.headers ?? {}),
              redirect: 'manual',
              signal: controller.signal,
            });
            return;
          } finally {
            clearTimeout(timeout);
          }
        } catch {
          // The process is running but has not bound its HTTP port yet.
        }
      }
      await this.wait(DEV_SERVER_READY_INTERVAL_MS);
    }
    throw new BadGatewayException(
      'Dev server did not become ready within 20 seconds.',
    );
  }

  private async wait(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private async connectSandbox(
    sandboxId: string,
    skipHealthCheck = false,
    preserveNotFound = false,
  ): Promise<Sandbox> {
    try {
      return await Sandbox.connect({
        connectionConfig: this.connectionConfig(),
        sandboxId,
        readyTimeoutSeconds: 30,
        skipHealthCheck,
      });
    } catch (error) {
      if (
        preserveNotFound &&
        error instanceof SandboxApiException &&
        error.statusCode === 404
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'OpenSandbox workspace is unavailable.',
      );
    }
  }

  private connectionConfig() {
    const domain = this.config.get<string>('opensandbox.domain')?.trim();
    const protocol = this.sandboxProtocol();
    if (!domain || (protocol !== 'http' && protocol !== 'https')) {
      throw new ServiceUnavailableException('OpenSandbox is not configured.');
    }
    const apiKey = this.config.get<string>('opensandbox.apiKey');
    return {
      domain,
      protocol,
      ...(apiKey ? { apiKey } : {}),
      useServerProxy: true,
      requestTimeoutSeconds: 30,
      disableMetrics: true,
    };
  }

  private sandboxProtocol(): 'http' | 'https' {
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

  private async getActiveWorkspace(
    threadId: string,
    userId: string,
    tenantId?: string,
  ) {
    const key = this.workspaceKey(threadId, userId, tenantId);
    const record = await this.readWorkspace(key, threadId, userId, tenantId);
    if (!record) throw new NotFoundException('Workspace has not been started.');
    if (record.expiresAt <= Date.now()) {
      throw new ConflictException(
        'Workspace has expired. Explicitly destroy it before starting a new workspace.',
      );
    }
    const sandbox = await this.connectSandbox(record.sandboxId);
    return { key, record, sandbox };
  }

  private async saveWorkspace(
    key: string,
    record: WorkspaceRecord,
  ): Promise<void> {
    await this.redis.setRequiredOrThrow(
      key,
      JSON.stringify(record),
      Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000)),
    );
  }

  private async readWorkspace(
    key: string,
    threadId: string,
    userId: string,
    tenantId?: string,
  ): Promise<WorkspaceRecord | null> {
    const raw = await this.readRequired(key);
    return this.parseWorkspace(raw, threadId, userId, tenantId);
  }

  private async readRequired(key: string): Promise<string | null> {
    this.assertRedis();
    try {
      return await this.redis.getRequired(key);
    } catch {
      throw new ServiceUnavailableException(
        'Workspace state storage is unavailable.',
      );
    }
  }

  private assertRedis(): void {
    if (!this.redis.isEnabled()) {
      throw new ServiceUnavailableException(
        'Workspace state storage is unavailable.',
      );
    }
  }

  private parseWorkspace(
    raw: string | null,
    threadId: string,
    userId: string,
    tenantId?: string,
  ): WorkspaceRecord | null {
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as WorkspaceRecord;
      if (
        value.version !== 1 ||
        value.threadId !== threadId ||
        value.ownerUserId !== userId ||
        value.tenantId !== (tenantId ?? null) ||
        typeof value.sandboxId !== 'string' ||
        typeof value.artifactId !== 'string' ||
        typeof value.createdAt !== 'string' ||
        typeof value.expiresAt !== 'number' ||
        !(
          value.devServer === null ||
          (typeof value.devServer?.commandId === 'string' &&
            Number.isInteger(value.devServer.port) &&
            typeof value.devServer.startedAt === 'string')
        )
      ) {
        throw new Error('invalid workspace record');
      }
      return value;
    } catch {
      throw new ServiceUnavailableException('Workspace state is invalid.');
    }
  }

  private parseTicket(raw: string | null): PreviewTicketRecord {
    if (!raw) throw new NotFoundException('Preview ticket not found.');
    try {
      const value = JSON.parse(raw) as PreviewTicketRecord;
      if (
        value.version !== 1 ||
        typeof value.workspaceKey !== 'string' ||
        typeof value.ownerUserId !== 'string' ||
        typeof value.threadId !== 'string' ||
        typeof value.sandboxId !== 'string' ||
        !Number.isInteger(value.port) ||
        typeof value.expiresAt !== 'number'
      ) {
        throw new Error('invalid ticket');
      }
      return value;
    } catch {
      throw new NotFoundException('Preview ticket not found.');
    }
  }

  private async unpackSeedZip(body: Buffer) {
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

  private normalizeArchivePath(value: string): string | null {
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

  private validateCommand(command: string, maxLength: number): string {
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

  private validateTimeout(timeoutSeconds: number): number {
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

  private commandOutput(execution: SandboxCommandOutput): string {
    const chunks = [
      ...(execution.logs?.stdout ?? []).map((entry) => entry.text ?? ''),
      ...(execution.logs?.stderr ?? []).map((entry) => entry.text ?? ''),
      execution.error?.value ?? '',
    ];
    return this.truncateOutput(chunks.filter(Boolean).join(''));
  }

  private truncateOutput(output: string): string {
    const bytes = Buffer.from(output);
    if (bytes.length <= MAX_COMMAND_OUTPUT_BYTES) return output;
    const marker = '\n[output truncated]';
    const limit = MAX_COMMAND_OUTPUT_BYTES - Buffer.byteLength(marker);
    return `${bytes.subarray(bytes.length - limit).toString()}${marker}`;
  }

  private validatePreviewPath(input: string): string {
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

  private buildEndpointUrl(endpointUrl: string, path: string): URL {
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

  private previewRequestHeaders(
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

  private previewResponseHeaders(
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

  private async readResponseBody(
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

  private serializeQuery(query: WorkspacePreviewRequest['query']): string {
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

  private workspaceRelativePath(path: string): string | null {
    const prefix = `${WORKSPACE_ROOT}/`;
    if (!path.startsWith(prefix)) return null;
    const relative = path.slice(prefix.length);
    return this.normalizeArchivePath(relative);
  }

  private workspaceKey(
    threadId: string,
    userId: string,
    tenantId?: string,
  ): string {
    const identity = JSON.stringify([tenantId ?? null, userId, threadId]);
    return `workspace:project:v1:${this.hash(identity)}`;
  }

  private async withWorkspaceLock<T>(
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

  private previewKey(ticket: string): string {
    return `workspace:preview:v1:${this.hash(ticket)}`;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private assertIdentity(threadId: string, userId: string): void {
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

  private assertArtifactTenant(
    artifact: { tenantId?: string | null },
    tenantId?: string,
  ): void {
    if (artifact.tenantId !== (tenantId ?? null)) {
      throw new ForbiddenException('Artifact does not belong to this tenant.');
    }
  }

  private toStatus(record: WorkspaceRecord, ready = true): WorkspaceStatus {
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

  private async artifactFramework(
    artifactId: string,
    userId: string,
    threadId: string,
  ): Promise<string | null> {
    const artifact = await this.artifacts.getStudioVersion(
      artifactId,
      userId,
      threadId,
    );
    try {
      const metadata = JSON.parse(artifact.metadata ?? '{}') as Record<
        string,
        unknown
      >;
      return typeof metadata.framework === 'string' ? metadata.framework : null;
    } catch {
      return null;
    }
  }
}
