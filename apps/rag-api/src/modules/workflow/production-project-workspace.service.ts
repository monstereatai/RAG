import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
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
  DEV_SERVER_READY_INTERVAL_MS,
  DEV_SERVER_READY_TIMEOUT_MS,
  MAX_COMMAND_LENGTH,
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_DEV_COMMAND_LENGTH,
  MAX_EXPORT_BYTES,
  MAX_SEED_FILES,
  MAX_SEED_ZIP_BYTES,
  MAX_SINGLE_FILE_BYTES,
  PREVIEW_TICKET_TTL_SECONDS,
  PREVIEW_UPSTREAM_TIMEOUT_MS,
  WORKSPACE_ROOT,
  WORKSPACE_TTL_SECONDS,
  type SandboxCommandOutput,
  type PreviewTicketRecord,
  type WorkspaceRecord,
} from './production-project-workspace.shared';
import { ProductionProjectWorkspaceSupport } from './production-project-workspace.support';
import {
  StartDevServerInput,
  WorkspaceCommandResult,
  WorkspaceDevServerStatus,
  WorkspacePreviewRequest,
  WorkspacePreviewTicket,
  WorkspaceProxyResponse,
  WorkspaceStatus,
} from './production-project-workspace.dto';

@Injectable()
export class ProductionProjectWorkspaceService extends ProductionProjectWorkspaceSupport {
  constructor(
    protected readonly config: ConfigService,
    protected readonly redis: RedisProvider,
    private readonly workflow: ProductionWorkflowService,
    protected readonly artifacts: ArtifactsService,
  ) {
    super();
  }

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
    role: 'frontend' | 'backend' | 'qa' = 'frontend',
    task: 'code' | 'verify' = role === 'qa' ? 'verify' : 'code',
    strictRole = false,
  ): Promise<WorkspaceStatus> {
    this.assertIdentity(threadId, userId);
    if (!artifactId || artifactId.length > 64) {
      throw new BadRequestException('artifactId is invalid.');
    }
    const workflowContext = await this.workflow.codingContext(
      threadId,
      userId,
      tenantId,
    );
    const artifact = await this.artifacts.getStudioVersion(
      artifactId,
      userId,
      threadId,
    );
    this.assertArtifactTenant(artifact, tenantId);
    if (
      artifact.status !== 'ready' ||
      artifact.kind !== 'code' ||
      !artifact.filename.toLowerCase().endsWith('.zip') ||
      !this.artifactMatchesRole(artifact.metadata, role, artifact.sourceText) ||
      (strictRole &&
        !this.agentRoleMatchesScope(
          workflowContext.selectedRoles,
          artifact.metadata,
          role,
          task,
        ))
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
      if (!this.backendArchiveManifestIsValid(artifact.metadata, files)) {
        throw new BadRequestException(
          'NestJS 后端 ZIP 缺少可运行的 package scripts 或入口文件。',
        );
      }
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

  async validateCodingArtifact(
    threadId: string,
    userId: string,
    tenantId: string | undefined,
    artifactId: string,
    role: 'frontend' | 'backend' | 'qa' = 'frontend',
    task: 'code' | 'verify' = role === 'qa' ? 'verify' : 'code',
    strictRole = false,
  ): Promise<
    Awaited<ReturnType<ProductionWorkflowService['codingContext']>> & {
      artifactMetadata: string | null;
    }
  > {
    this.assertIdentity(threadId, userId);
    if (!artifactId || artifactId.length > 64) {
      throw new BadRequestException('artifactId is invalid.');
    }
    const workflowContext = await this.workflow.codingContext(
      threadId,
      userId,
      tenantId,
    );
    const artifact = await this.artifacts.getStudioVersion(
      artifactId,
      userId,
      threadId,
    );
    this.assertArtifactTenant(artifact, tenantId);
    if (
      artifact.status !== 'ready' ||
      artifact.kind !== 'code' ||
      !artifact.filename.toLowerCase().endsWith('.zip') ||
      !this.artifactMatchesRole(artifact.metadata, role, artifact.sourceText) ||
      (strictRole &&
        !this.agentRoleMatchesScope(
          workflowContext.selectedRoles,
          artifact.metadata,
          role,
          task,
        ))
    ) {
      throw new BadRequestException(
        'Workspace requires a ready generated code ZIP artifact.',
      );
    }
    return { ...workflowContext, artifactMetadata: artifact.metadata };
  }

  async assertWorkspaceReady(
    threadId: string,
    userId: string,
    tenantId: string | undefined,
    artifactId: string,
    role: 'frontend' | 'backend' | 'qa' = 'frontend',
    task: 'code' | 'verify' = role === 'qa' ? 'verify' : 'code',
    strictRole = false,
  ): Promise<void> {
    await this.validateCodingArtifact(
      threadId,
      userId,
      tenantId,
      artifactId,
      role,
      task,
      strictRole,
    );
    const { record, sandbox } = await this.getActiveWorkspace(
      threadId,
      userId,
      tenantId,
    );
    try {
      if (record.artifactId !== artifactId) {
        throw new ConflictException(
          'Workspace does not match the requested ZIP artifact.',
        );
      }
    } finally {
      await sandbox.close();
    }
  }

  async verifyWorkspace(
    threadId: string,
    userId: string,
    tenantId: string | undefined,
    artifactId: string,
    signal?: AbortSignal,
    role: 'frontend' | 'backend' | 'qa' = 'frontend',
    task: 'code' | 'verify' = role === 'qa' ? 'verify' : 'code',
    strictRole = false,
  ) {
    const { diff, scripts, manifestError } = await this.inspectWorkspace(
      threadId,
      userId,
      tenantId,
      artifactId,
      role,
      task,
      strictRole,
    );
    const checks: Record<
      'lint' | 'test' | 'build',
      {
        status: 'passed' | 'failed' | 'not_applicable' | 'not_run';
        command: string | null;
        exitCode: number | null;
        output: string;
        reason?: string;
      }
    > = {
      lint: { status: 'not_applicable', command: null, exitCode: null, output: '', reason: 'package.json 未声明 lint 脚本。' },
      test: { status: 'not_applicable', command: null, exitCode: null, output: '', reason: 'package.json 未声明 test 脚本。' },
      build: { status: 'not_applicable', command: null, exitCode: null, output: '', reason: 'package.json 未声明 build 脚本。' },
    };

    if (manifestError) {
      for (const name of ['lint', 'test', 'build'] as const) {
        checks[name] = {
          status: 'failed',
          command: null,
          exitCode: null,
          output: '',
          reason: manifestError,
        };
      }
    } else {
      for (const name of ['lint', 'test', 'build'] as const) {
        if (!scripts[name]) continue;
        const command = `npm run ${name}`;
        if (signal?.aborted) {
          checks[name] = {
            status: 'not_run',
            command,
            exitCode: null,
            output: '',
            reason: '任务已取消，未运行此检查。',
          };
          continue;
        }
        try {
          const result = await this.runCommand(
            threadId,
            userId,
            tenantId,
            command,
            240,
            signal,
          );
          checks[name] = {
            status:
              result.exitCode === 0 && !result.timedOut ? 'passed' : 'failed',
            command,
            exitCode: result.exitCode,
            output: result.output,
            ...(result.timedOut ? { reason: '命令超时。' } : {}),
          };
        } catch (error) {
          checks[name] = {
            status: signal?.aborted ? 'not_run' : 'failed',
            command,
            exitCode: null,
            output: '',
            reason:
              error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
          };
        }
      }
    }

    return { checkedAt: new Date().toISOString(), diff, checks };
  }

  private async inspectWorkspace(
    threadId: string,
    userId: string,
    tenantId: string | undefined,
    artifactId: string,
    role: 'frontend' | 'backend' | 'qa',
    task: 'code' | 'verify',
    strictRole: boolean,
  ) {
    this.assertIdentity(threadId, userId);
    const workflowContext = await this.validateCodingArtifact(
      threadId,
      userId,
      tenantId,
      artifactId,
      role,
      task,
      strictRole,
    );
    const { record, sandbox } = await this.getActiveWorkspace(
      threadId,
      userId,
      tenantId,
    );
    try {
      if (record.artifactId !== artifactId) {
        throw new ConflictException(
          'Workspace does not match the requested ZIP artifact.',
        );
      }
      const source = await this.artifacts.getStudioVersionFile(
        artifactId,
        userId,
        threadId,
      );
      const seedFiles = await this.unpackSeedZip(source.body);
      if (
        !this.backendArchiveManifestIsValid(
          workflowContext.artifactMetadata,
          seedFiles,
        )
      ) {
        throw new BadRequestException(
          'NestJS 后端 ZIP 缺少可运行的 package scripts 或入口文件。',
        );
      }
      const seed = new Map<string, Buffer>();
      for (const file of seedFiles) {
        const path = this.workspaceRelativePath(file.path);
        if (!path || this.isIgnoredWorkspacePath(path)) continue;
        seed.set(path, Buffer.from(file.data));
      }

      const entries = await sandbox.files.listDirectory({
        path: WORKSPACE_ROOT,
        depth: 32,
      });
      if (entries.length > MAX_SEED_FILES * 2) {
        throw new BadRequestException('Workspace contains too many files to verify.');
      }
      const current = new Map<string, Buffer>();
      let totalBytes = 0;
      for (const file of entries) {
        const path = this.workspaceRelativePath(file.path);
        if (
          !path ||
          file.type === 'directory' ||
          file.type === 'symlink' ||
          (file.type && file.type !== 'file') ||
          this.isIgnoredWorkspacePath(path)
        ) {
          continue;
        }
        if (typeof file.size === 'number' && file.size > MAX_SINGLE_FILE_BYTES) {
          throw new BadRequestException('Workspace file exceeds the verification size limit.');
        }
        const data = Buffer.from(await sandbox.files.readBytes(file.path));
        totalBytes += data.length;
        if (
          data.length > MAX_SINGLE_FILE_BYTES ||
          totalBytes > MAX_EXPORT_BYTES ||
          current.size >= MAX_SEED_FILES ||
          current.has(path)
        ) {
          throw new BadRequestException('Workspace exceeds the verification size limit.');
        }
        current.set(path, data);
      }

      let scripts: Partial<Record<'lint' | 'test' | 'build', string>> = {};
      let manifestError: string | undefined;
      const packageFile = current.get('package.json');
      if (packageFile) {
        try {
          const packageJson = JSON.parse(packageFile.toString('utf8')) as {
            scripts?: unknown;
          };
          if (
            !packageJson.scripts ||
            typeof packageJson.scripts !== 'object' ||
            Array.isArray(packageJson.scripts)
          ) {
            scripts = {};
          } else {
            const declared = packageJson.scripts as Record<string, unknown>;
            for (const name of ['lint', 'test', 'build'] as const) {
              const value = declared[name];
              if (typeof value === 'string' && value.trim()) {
                scripts[name] = value;
              } else if (value !== undefined) {
                manifestError = `package.json 的 ${name} 脚本定义无效。`;
              }
            }
          }
        } catch {
          manifestError = 'package.json 无法解析，确定性验收未运行。';
        }
      }

      const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
      const added = [...current.keys()]
        .filter((path) => !seed.has(path))
        .sort()
        .map((path) => ({ path, sha256: hash(current.get(path)!) }));
      const deleted = [...seed.keys()]
        .filter((path) => !current.has(path))
        .sort()
        .map((path) => ({ path, sha256: hash(seed.get(path)!) }));
      const modified = [...current.keys()]
        .filter((path) => seed.has(path) && hash(current.get(path)!) !== hash(seed.get(path)!))
        .sort()
        .map((path) => ({
          path,
          seedSha256: hash(seed.get(path)!),
          workspaceSha256: hash(current.get(path)!),
        }));
      return {
        diff: { added, modified, deleted },
        scripts,
        manifestError,
      };
    } finally {
      await sandbox.close();
    }
  }

  private isIgnoredWorkspacePath(path: string): boolean {
    return path
      .split('/')
      .some((part) => part === 'node_modules' || part === '.git');
  }

  private parseArtifactMetadata(rawMetadata: string | null): Record<string, unknown> {
    try {
      const parsed = JSON.parse(rawMetadata ?? '{}') as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private artifactMatchesRole(
    rawMetadata: string | null,
    role: 'frontend' | 'backend' | 'qa',
    sourceText: string,
  ): boolean {
    let target: unknown;
    try {
      target = (JSON.parse(rawMetadata ?? '{}') as Record<string, unknown>)
        .target;
    } catch {
      return false;
    }
    const frontendTargets = [
      'vue-page',
      'react-page',
      'vue-dashboard',
      'react-dashboard',
    ];
    const matchesRole =
      role === 'frontend'
        ? frontendTargets.includes(String(target))
        : role === 'backend'
          ? target === 'nestjs-api'
          : frontendTargets.includes(String(target)) || target === 'nestjs-api';
    if (!matchesRole) return false;
    if (target !== 'nestjs-api') return true;
    try {
      const source = JSON.parse(sourceText) as {
        framework?: unknown;
        files?: unknown;
      };
      return (
        source.framework === 'nestjs' &&
        source.files !== null &&
        typeof source.files === 'object' &&
        !Array.isArray(source.files) &&
        this.nestJsFilesManifestIsValid(source.files as Record<string, unknown>)
      );
    } catch {
      return false;
    }
  }

  private backendArchiveManifestIsValid(
    rawMetadata: string | null,
    files: Array<{ path: string; data: Uint8Array }>,
  ): boolean {
    let target: unknown;
    try {
      target = (JSON.parse(rawMetadata ?? '{}') as Record<string, unknown>)
        .target;
    } catch {
      return false;
    }
    if (target !== 'nestjs-api') return true;
    return this.nestJsFilesManifestIsValid(
      Object.fromEntries(
        files.map((file) => [
          file.path,
          Buffer.from(file.data).toString('utf8'),
        ]),
      ),
    );
  }

  private nestJsFilesManifestIsValid(
    files: Record<string, unknown>,
  ): boolean {
    try {
      const packageJson = JSON.parse(String(files['package.json'])) as {
        scripts?: Record<string, unknown>;
      };
      const scripts = packageJson.scripts ?? {};
      return (
        [
          'src/main.ts',
          'src/app.module.ts',
          'src/app.controller.ts',
          'src/app.service.ts',
          'src/dto/create-task.dto.ts',
          'test/app.service.test.js',
        ].every((path) => typeof files[path] === 'string') &&
        ['start', 'start:dev', 'build', 'lint', 'test'].every(
          (name) =>
            typeof scripts[name] === 'string' &&
            (scripts[name] as string).trim().length > 0,
        )
      );
    } catch {
      return false;
    }
  }

  private agentRoleMatchesScope(
    selectedRoles: string[],
    rawMetadata: string | null,
    role: 'frontend' | 'backend' | 'qa',
    task: 'code' | 'verify',
  ): boolean {
    let target: unknown;
    try {
      target = (JSON.parse(rawMetadata ?? '{}') as Record<string, unknown>)
        .target;
    } catch {
      return false;
    }
    const artifactRole =
      target === 'nestjs-api'
        ? 'backend'
        : ['vue-page', 'react-page', 'vue-dashboard', 'react-dashboard'].includes(
              String(target),
            )
          ? 'frontend'
          : null;
    if (!artifactRole) return false;
    if (role === 'qa' && task === 'verify') {
      return selectedRoles.includes('qa') && selectedRoles.includes(artifactRole);
    }
    return task === 'code' && role === artifactRole && selectedRoles.includes(role);
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
      execution = await sandbox.commands.run(
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
      );
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
    task?: {
      taskId: string;
      role: 'frontend' | 'backend';
      parentRunId: string | null;
      traceId: string;
    },
  ): Promise<Awaited<ReturnType<ArtifactsService['createStudioVersion']>>> {
    this.assertIdentity(threadId, userId);
    await this.workflow.codingContext(threadId, userId, tenantId);
    if (task) {
      const existing = (await this.artifacts.listStudioVersions(userId, threadId))
        .find(
          (item) =>
            item.status === 'ready' &&
            item.metadata?.codingTaskId === task.taskId,
        );
      if (existing) {
        const existingRecord = await this.artifacts.getStudioVersion(
          existing.id,
          userId,
          threadId,
        );
        if ((existingRecord.tenantId ?? null) === (tenantId ?? null)) {
          return existing as Awaited<
            ReturnType<ArtifactsService['createStudioVersion']>
          >;
        }
      }
    }
    const { record, sandbox } = await this.getActiveWorkspace(
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
      const sourceArtifact = await this.artifacts.getStudioVersion(
        record.artifactId,
        userId,
        threadId,
      );
      const sourceMetadata = this.parseArtifactMetadata(
        sourceArtifact.metadata,
      );
      const target = String(sourceMetadata.target ?? 'workspace-export');
      const zip = new JSZip();
      const sourceFiles: Record<string, string> = {};
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
        sourceFiles[relativePath] = bytes.toString('utf8');
      }
      const body = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
      });
      const existingVersions = await this.artifacts.listStudioVersions(
        userId,
        threadId,
      );
      const version =
        Math.max(
          0,
          ...existingVersions
            .filter((item) => item.metadata?.target === target)
            .map((item) => Number(item.metadata?.version) || 0),
        ) + 1;
      const framework =
        typeof sourceMetadata.framework === 'string'
          ? sourceMetadata.framework
          : 'unknown';
      const artifact = await this.artifacts.createStudioVersion({
        ownerUserId: userId,
        tenantId,
        threadId,
        title: `工作区导出 v${version}`,
        kind: 'code',
        filename: `workspace-export-v${version}.zip`,
        sourceText: JSON.stringify({
          framework,
          files: sourceFiles,
          sourceWorkspaceArtifactId: record.artifactId,
          exportedAt: new Date().toISOString(),
          fileCount,
        }),
        body,
        contentType: 'application/zip',
        metadata: {
          ...sourceMetadata,
          target,
          version,
          parentArtifactId: record.artifactId,
          sourceArtifactId: record.artifactId,
          fileCount,
          sourceEdited: true,
          ...(task
            ? {
                codingTaskId: task.taskId,
                role: task.role,
                taskType: 'code',
                parentRunId: task.parentRunId,
                traceId: task.traceId,
              }
            : {}),
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
        secureAccess: true,
        resource: {
          cpu: this.config.get<string>('opensandbox.cpuLimit') ?? '2',
          memory: this.config.get<string>('opensandbox.memoryLimit') ?? '4Gi',
          disk: this.config.get<string>('opensandbox.diskLimit') ?? '8Gi',
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
}
