import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import JSZip from 'jszip';
import { Sandbox } from '@alibaba-group/opensandbox';
import { createHash } from 'node:crypto';
import { ProductionProjectWorkspaceService } from './production-project-workspace.service';

const identityKey = (
  tenantId: string | undefined,
  userId: string,
  threadId: string,
) =>
  `workspace:project:v1:${createHash('sha256')
    .update(JSON.stringify([tenantId ?? null, userId, threadId]))
    .digest('hex')}`;

const workspaceRecord = (
  threadId = 'thread-1',
  userId = 'owner-1',
  tenantId: string | null = 'tenant-1',
) => ({
  version: 1,
  threadId,
  ownerUserId: userId,
  tenantId,
  sandboxId: 'sandbox-1',
  artifactId: 'artifact-1',
  createdAt: new Date().toISOString(),
  expiresAt: Date.now() + 60_000,
  devServer: null as null | {
    commandId: string;
    port: number;
    startedAt: string;
  },
});

describe('ProductionProjectWorkspaceService', () => {
  const redisValues = new Map<string, string>();
  const redisLocks = new Set<string>();
  let sandbox: ReturnType<typeof makeSandbox>;
  let service: ProductionProjectWorkspaceService;
  let redis: Record<string, jest.Mock>;
  let artifacts: Record<string, jest.Mock>;
  let createdStudioVersionInput: Record<string, unknown> | undefined;
  let createSandbox: jest.SpyInstance;
  let connectSandbox: jest.SpyInstance;

  async function makeArchive(path = 'src/main.ts', content = 'export {};') {
    return new JSZip()
      .file(path, content)
      .generateAsync({ type: 'nodebuffer' });
  }

  function makeSandbox() {
    return {
      id: 'sandbox-1',
      files: {
        createDirectories: jest.fn().mockResolvedValue(undefined),
        writeFiles: jest.fn().mockResolvedValue(undefined),
        listDirectory: jest.fn().mockResolvedValue([]),
        readBytes: jest.fn().mockResolvedValue(Buffer.from('')),
      },
      commands: {
        run: jest.fn().mockResolvedValue({ id: 'command-1', exitCode: 0 }),
        interrupt: jest.fn().mockResolvedValue(undefined),
        getCommandStatus: jest.fn().mockResolvedValue({ running: true }),
      },
      getEndpoint: jest.fn().mockResolvedValue({
        endpoint: 'preview.example.test:43000',
        headers: { 'x-sandbox-token': 'opaque-token' },
      }),
      getEndpointUrl: jest
        .fn()
        .mockResolvedValue('http://preview.example.test:43000'),
      kill: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
  }

  function setup() {
    redisValues.clear();
    redisLocks.clear();
    createdStudioVersionInput = undefined;
    sandbox = makeSandbox();
    redis = {
      isEnabled: jest.fn(() => true),
      getRequired: jest.fn((key: string) =>
        Promise.resolve(redisValues.get(key) ?? null),
      ),
      setIfAbsentRequired: jest.fn((key: string) => {
        if (redisLocks.has(key)) return Promise.resolve(false);
        redisLocks.add(key);
        return Promise.resolve(true);
      }),
      releaseLock: jest.fn((key: string) => {
        redisLocks.delete(key);
        return Promise.resolve();
      }),
      setRequiredOrThrow: jest.fn((key: string, value: string) => {
        redisValues.set(key, value);
        return Promise.resolve();
      }),
      delRequired: jest.fn((key: string) => {
        redisValues.delete(key);
        return Promise.resolve();
      }),
      expireRequired: jest.fn().mockResolvedValue(undefined),
    };
    artifacts = {
      listStudioVersions: jest.fn().mockResolvedValue([]),
      getStudioVersion: jest.fn((id: string) =>
        Promise.resolve({
          id,
          tenantId: 'tenant-1',
          ownerUserId: 'owner-1',
          threadId: 'thread-1',
          status: 'ready',
          kind: 'code',
          filename: `${id}.zip`,
          metadata: JSON.stringify({
            studio: 'production',
            target: 'vue-page',
            framework: 'vue',
          }),
        }),
      ),
      getStudioVersionFile: jest.fn(async () => ({
        body: await makeArchive(),
      })),
      createStudioVersion: jest.fn((input: Record<string, unknown>) => {
        createdStudioVersionInput = input;
        return Promise.resolve({
          id: 'artifact-export-1',
          status: 'ready',
          ...input,
        });
      }),
    };
    const configValues: Record<string, unknown> = {
      'opensandbox.domain': 'opensandbox.test:8090',
      'opensandbox.protocol': 'http',
      'opensandbox.apiKey': 'unit-test-key',
      'opensandbox.image': 'workspace-node:test',
      'opensandbox.cpuLimit': '2',
      'opensandbox.memoryLimit': '4Gi',
      'opensandbox.diskLimit': '8Gi',
      'opensandbox.egressAllowlist': ['registry.npmjs.org'],
    };
    const config = { get: jest.fn((key: string) => configValues[key]) };
    const workflow = {
      codingContext: jest.fn().mockResolvedValue({ threadId: 'thread-1' }),
    };
    service = new ProductionProjectWorkspaceService(
      config as never,
      redis as never,
      workflow as never,
      artifacts as never,
    );
    createSandbox = jest
      .spyOn(Sandbox, 'create')
      .mockResolvedValue(sandbox as never);
    connectSandbox = jest
      .spyOn(Sandbox, 'connect')
      .mockResolvedValue(sandbox as never);
    return { config, workflow };
  }

  beforeEach(() => {
    jest.restoreAllMocks();
    setup();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('isolates workspace state by tenant, owner, and thread', async () => {
    const archive = await makeArchive();
    artifacts.getStudioVersionFile.mockResolvedValue({ body: archive });
    await service.startWorkspace(
      'thread-1',
      'owner-1',
      'tenant-1',
      'artifact-1',
    );

    await expect(
      service.getStatus('thread-1', 'owner-2', 'tenant-1'),
    ).resolves.toMatchObject({
      active: false,
      ready: false,
      projectRoot: null,
    });
    await expect(
      service.getStatus('thread-1', 'owner-1', 'tenant-2'),
    ).resolves.toMatchObject({
      active: false,
    });
    await expect(
      service.getStatus('thread-2', 'owner-1', 'tenant-1'),
    ).resolves.toMatchObject({
      active: false,
    });
    expect(
      redisValues.has(identityKey('tenant-1', 'owner-1', 'thread-1')),
    ).toBe(true);
    expect(connectSandbox).not.toHaveBeenCalled();
  });

  it('rejects a backend artifact whose source does not contain a runnable NestJS manifest', async () => {
    artifacts.getStudioVersion.mockResolvedValueOnce({
      id: 'artifact-1',
      tenantId: 'tenant-1',
      ownerUserId: 'owner-1',
      threadId: 'thread-1',
      status: 'ready',
      kind: 'code',
      filename: 'nestjs-api-v1.zip',
      metadata: JSON.stringify({ studio: 'production', target: 'nestjs-api' }),
      sourceText: JSON.stringify({ framework: 'react', files: {} }),
    });

    await expect(
      service.validateCodingArtifact(
        'thread-1',
        'owner-1',
        'tenant-1',
        'artifact-1',
        'backend',
        'code',
      ),
    ).rejects.toThrow('ready generated code ZIP');
  });

  it('requires both QA and source-role approval for an explicit verification task', async () => {
    const workflow = (
      service as unknown as {
        workflow: { codingContext: jest.Mock };
      }
    ).workflow;
    const backendFiles = {
      'package.json': JSON.stringify({
        scripts: {
          start: 'node dist/main.js',
          'start:dev': 'tsx watch src/main.ts',
          build: 'tsc -p tsconfig.json',
          lint: 'tsc --noEmit -p tsconfig.json',
          test: 'npm run build && node --test test/*.test.js',
        },
      }),
      'src/main.ts': 'export {};',
      'src/app.module.ts': 'export {};',
      'src/app.controller.ts': 'export {};',
      'src/app.service.ts': 'export {};',
      'src/dto/create-task.dto.ts': 'export {};',
      'test/app.service.test.js': 'test',
    };
    artifacts.getStudioVersion.mockResolvedValue({
      id: 'artifact-1',
      tenantId: 'tenant-1',
      ownerUserId: 'owner-1',
      threadId: 'thread-1',
      status: 'ready',
      kind: 'code',
      filename: 'nestjs-api-v1.zip',
      metadata: JSON.stringify({ studio: 'production', target: 'nestjs-api' }),
      sourceText: JSON.stringify({ framework: 'nestjs', files: backendFiles }),
    });
    workflow.codingContext
      .mockResolvedValueOnce({
        threadId: 'thread-1',
        runId: 'parent-run',
        selectedRoles: ['backend', 'qa'],
      })
      .mockResolvedValueOnce({
        threadId: 'thread-1',
        selectedRoles: ['backend'],
      });

    await expect(
      service.validateCodingArtifact(
        'thread-1',
        'owner-1',
        'tenant-1',
        'artifact-1',
        'qa',
        'verify',
        true,
      ),
    ).resolves.toMatchObject({
      runId: 'parent-run',
      artifactMetadata: expect.stringContaining('nestjs-api'),
    });
    await expect(
      service.validateCodingArtifact(
        'thread-1',
        'owner-1',
        'tenant-1',
        'artifact-1',
        'qa',
        'verify',
        true,
      ),
    ).rejects.toThrow('ready generated code ZIP');
  });

  it('rejects a backend ZIP missing the actual package scripts before creating a sandbox', async () => {
    const backendFiles = {
      'package.json': JSON.stringify({ scripts: { build: 'tsc' } }),
      'src/main.ts': 'export {};',
      'src/app.module.ts': 'export {};',
      'src/app.controller.ts': 'export {};',
      'src/app.service.ts': 'export {};',
      'src/dto/create-task.dto.ts': 'export {};',
      'test/app.service.test.js': 'test',
    };
    const validSourceFiles = {
      ...backendFiles,
      'package.json': JSON.stringify({
        scripts: {
          start: 'node dist/main.js',
          'start:dev': 'tsx watch src/main.ts',
          build: 'tsc -p tsconfig.json',
          lint: 'tsc --noEmit -p tsconfig.json',
          test: 'npm run build && node --test test/*.test.js',
        },
      }),
    };
    const archive = await new JSZip()
      .file('package.json', backendFiles['package.json'])
      .file('src/main.ts', backendFiles['src/main.ts'])
      .file('src/app.module.ts', backendFiles['src/app.module.ts'])
      .file('src/app.controller.ts', backendFiles['src/app.controller.ts'])
      .file('src/app.service.ts', backendFiles['src/app.service.ts'])
      .file('src/dto/create-task.dto.ts', backendFiles['src/dto/create-task.dto.ts'])
      .file('test/app.service.test.js', backendFiles['test/app.service.test.js'])
      .generateAsync({ type: 'nodebuffer' });
    artifacts.getStudioVersion.mockResolvedValueOnce({
      id: 'artifact-1',
      tenantId: 'tenant-1',
      ownerUserId: 'owner-1',
      threadId: 'thread-1',
      status: 'ready',
      kind: 'code',
      filename: 'nestjs-api-v1.zip',
      metadata: JSON.stringify({ studio: 'production', target: 'nestjs-api' }),
      sourceText: JSON.stringify({ framework: 'nestjs', files: validSourceFiles }),
    });
    artifacts.getStudioVersionFile.mockResolvedValueOnce({ body: archive });

    await expect(
      service.startWorkspace(
        'thread-1',
        'owner-1',
        'tenant-1',
        'artifact-1',
        'backend',
        'code',
      ),
    ).rejects.toThrow('ZIP 缺少可运行的 package scripts');
    expect(createSandbox).not.toHaveBeenCalled();
  });

  it('applies CPU, memory, and disk limits when creating a workspace', async () => {
    await service.startWorkspace(
      'thread-1',
      'owner-1',
      'tenant-1',
      'artifact-1',
    );

    expect(createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        secureAccess: true,
        resource: { cpu: '2', memory: '4Gi', disk: '8Gi' },
      }),
    );
  });

  it('does not replace a workspace seeded from another artifact', async () => {
    redisValues.set(
      identityKey('tenant-1', 'owner-1', 'thread-1'),
      JSON.stringify(workspaceRecord()),
    );

    await expect(
      service.startWorkspace('thread-1', 'owner-1', 'tenant-1', 'artifact-2'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(createSandbox).not.toHaveBeenCalled();
    expect(redis.setRequiredOrThrow).not.toHaveBeenCalled();
  });

  it('reconnects the same artifact without reseeding the modified workspace', async () => {
    redisValues.set(
      identityKey('tenant-1', 'owner-1', 'thread-1'),
      JSON.stringify(workspaceRecord()),
    );

    await expect(
      service.startWorkspace('thread-1', 'owner-1', 'tenant-1', 'artifact-1'),
    ).resolves.toMatchObject({ ready: true, artifactId: 'artifact-1' });
    expect(connectSandbox).toHaveBeenCalledTimes(1);
    expect(createSandbox).not.toHaveBeenCalled();
    expect(sandbox.files.writeFiles).not.toHaveBeenCalled();
  });

  it('serializes concurrent workspace starts for the same owner and thread', async () => {
    const archive = await makeArchive();
    artifacts.getStudioVersionFile.mockResolvedValue({ body: archive });

    const results = await Promise.all([
      service.startWorkspace('thread-1', 'owner-1', 'tenant-1', 'artifact-1'),
      service.startWorkspace('thread-1', 'owner-1', 'tenant-1', 'artifact-1'),
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.ready)).toBe(true);
    expect(createSandbox).toHaveBeenCalledTimes(1);
    expect(redisLocks.size).toBe(0);
  });

  it('rejects unsafe ZIP paths before creating a sandbox', async () => {
    const archive = await makeArchive('../escape.ts', 'unsafe');
    artifacts.getStudioVersionFile.mockResolvedValue({ body: archive });

    await expect(
      service.startWorkspace('thread-1', 'owner-1', 'tenant-1', 'artifact-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createSandbox).not.toHaveBeenCalled();
  });

  it('rejects invalid commands and clamps command output to 16 KiB', async () => {
    await expect(
      service.runCommand('thread-1', 'owner-1', 'tenant-1', 'x'.repeat(4097)),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.runCommand('thread-1', 'owner-1', 'tenant-1', 'npm test', 241),
    ).rejects.toBeInstanceOf(BadRequestException);

    redisValues.set(
      identityKey('tenant-1', 'owner-1', 'thread-1'),
      JSON.stringify(workspaceRecord()),
    );
    sandbox.commands.run.mockImplementation(
      async (
        _command,
        _options,
        handlers: {
          onStdout(event: { text: string; timestamp: number }): Promise<void>;
        },
      ) => {
        await handlers.onStdout({ text: 'x'.repeat(20_000), timestamp: 1 });
        return { logs: { stdout: [], stderr: [] }, exitCode: 0 };
      },
    );
    const result = await service.runCommand(
      'thread-1',
      'owner-1',
      'tenant-1',
      'npm test',
      30,
    );
    expect(result).toMatchObject({
      command: 'npm test',
      exitCode: 0,
      timedOut: false,
    });
    expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(16 * 1024);
    expect(redis.setRequiredOrThrow).not.toHaveBeenCalled();
  });

  it('aborts a timed out command and reports the timeout', async () => {
    redisValues.set(
      identityKey('tenant-1', 'owner-1', 'thread-1'),
      JSON.stringify(workspaceRecord()),
    );
    sandbox.commands.run.mockImplementation(
      (_command, _options, _handlers, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    jest.useFakeTimers();
    const run = service.runCommand(
      'thread-1',
      'owner-1',
      'tenant-1',
      'npm test',
      1,
    );
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(run).resolves.toMatchObject({
      timedOut: true,
      exitCode: null,
    });
    expect(sandbox.close).toHaveBeenCalled();
  });

  it('returns running only after the dev server endpoint responds', async () => {
    redisValues.set(
      identityKey('tenant-1', 'owner-1', 'thread-1'),
      JSON.stringify(workspaceRecord()),
    );
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 404 }));

    await expect(
      service.startDevServer('thread-1', 'owner-1', 'tenant-1', { port: 5173 }),
    ).resolves.toMatchObject({
      status: 'running',
      port: 5173,
      commandId: 'command-1',
    });
    const saved = JSON.parse(
      redisValues.get(identityKey('tenant-1', 'owner-1', 'thread-1'))!,
    ) as ReturnType<typeof workspaceRecord>;
    expect(saved.devServer?.commandId).toBe('command-1');
    expect(fetchSpy).toHaveBeenCalledWith(
      new URL('http://preview.example.test:43000/'),
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' }),
    );
  });

  it('interrupts a dev command that exits before its endpoint is ready', async () => {
    redisValues.set(
      identityKey('tenant-1', 'owner-1', 'thread-1'),
      JSON.stringify(workspaceRecord()),
    );
    sandbox.commands.getCommandStatus.mockResolvedValue({ running: false });

    await expect(
      service.startDevServer('thread-1', 'owner-1', 'tenant-1', {
        port: 5173,
        command: 'npm run dev',
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(sandbox.commands.interrupt).toHaveBeenCalledWith('command-1');
    const persistedWorkspace = JSON.parse(
      redisValues.get(identityKey('tenant-1', 'owner-1', 'thread-1'))!,
    ) as unknown as { devServer: unknown };
    expect(persistedWorkspace.devServer).toBeNull();
  });

  it('binds short lived preview tickets to their thread and rejects traversal', async () => {
    const record = {
      ...workspaceRecord(),
      devServer: {
        commandId: 'command-1',
        port: 5173,
        startedAt: new Date().toISOString(),
      },
    };
    redisValues.set(
      identityKey('tenant-1', 'owner-1', 'thread-1'),
      JSON.stringify(record),
    );
    const { ticket, expiresInSeconds } = await service.issuePreviewTicket(
      'thread-1',
      'owner-1',
      'tenant-1',
      5173,
    );
    expect(expiresInSeconds).toBe(300);
    await expect(
      service.proxyPreview(ticket, 'thread-2', {
        method: 'GET',
        path: '',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.proxyPreview(ticket, 'thread-1', {
        method: 'GET',
        path: '%2e%2e/secrets',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const ticketEntry = [...redisValues.entries()].find(([key]) =>
      key.startsWith('workspace:preview:v1:'),
    );
    expect(ticketEntry).toBeDefined();
    const expired = JSON.parse(ticketEntry![1]) as { expiresAt: number };
    expired.expiresAt = Date.now() - 1;
    redisValues.set(ticketEntry![0], JSON.stringify(expired));
    await expect(
      service.proxyPreview(ticket, 'thread-1', {
        method: 'GET',
        path: '',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not follow preview redirects to an untrusted host', async () => {
    const record = {
      ...workspaceRecord(),
      devServer: {
        commandId: 'command-1',
        port: 5173,
        startedAt: new Date().toISOString(),
      },
    };
    redisValues.set(
      identityKey('tenant-1', 'owner-1', 'thread-1'),
      JSON.stringify(record),
    );
    const { ticket } = await service.issuePreviewTicket(
      'thread-1',
      'owner-1',
      'tenant-1',
      5173,
    );
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
      }),
    );
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    const response = await service.proxyPreview(ticket, 'thread-1', {
      method: 'GET',
      path: 'index.html',
      query: 'mode=preview',
      headers: { accept: 'text/html' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: 'manual', method: 'GET' }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.location).toBeUndefined();
    expect(response.headers['content-security-policy']).toContain('sandbox');
  });

  it('aborts the sandbox preview fetch when the caller disconnects', async () => {
    const record = {
      ...workspaceRecord(),
      devServer: {
        commandId: 'command-1',
        port: 5173,
        startedAt: new Date().toISOString(),
      },
    };
    redisValues.set(
      identityKey('tenant-1', 'owner-1', 'thread-1'),
      JSON.stringify(record),
    );
    const { ticket } = await service.issuePreviewTicket(
      'thread-1',
      'owner-1',
      'tenant-1',
      5173,
    );
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetchMock = jest.fn(
      (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            {
              once: true,
            },
          );
          markStarted();
        }),
    );
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
    const caller = new AbortController();
    const proxyRequest = service.proxyPreview(ticket, 'thread-1', {
      method: 'GET',
      path: 'index.html',
      signal: caller.signal,
    });

    await started;
    caller.abort();

    await expect(proxyRequest).rejects.toMatchObject({
      message: 'Sandbox preview request failed.',
    });
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(sandbox.close).toHaveBeenCalled();
  });

  it('exports workspace source through artifact storage and requires discard confirmation', async () => {
    redisValues.set(
      identityKey('tenant-1', 'owner-1', 'thread-1'),
      JSON.stringify(workspaceRecord()),
    );
    sandbox.files.listDirectory.mockResolvedValue([
      { path: '/root/workspace/src/main.ts', type: 'file', size: 10 },
      {
        path: '/root/workspace/node_modules/pkg/index.js',
        type: 'file',
        size: 20,
      },
      { path: '/root/workspace/.git/config', type: 'file', size: 20 },
      { path: '/root/workspace/src/outside.ts', type: 'symlink', size: 10 },
      { path: '/root/workspace-escape/secrets.txt', type: 'file', size: 10 },
      { path: '/root/workspace/src/../outside.ts', type: 'file', size: 10 },
    ]);
    sandbox.files.readBytes.mockResolvedValue(Buffer.from('export {};'));

    await expect(
      service.destroyWorkspace('thread-1', 'owner-1', 'tenant-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    const artifact = await service.exportWorkspace(
      'thread-1',
      'owner-1',
      'tenant-1',
    );
    const input = createdStudioVersionInput;
    if (
      !input ||
      !(input.body instanceof Buffer) ||
      typeof input.filename !== 'string' ||
      !input.metadata ||
      typeof input.metadata !== 'object'
    ) {
      throw new Error('Expected a complete exported workspace artifact.');
    }
    const exported = await JSZip.loadAsync(input.body);
    expect(Object.keys(exported.files)).toEqual(['src/', 'src/main.ts']);
    expect(sandbox.files.readBytes).toHaveBeenCalledTimes(1);
    expect(sandbox.files.readBytes).toHaveBeenCalledWith(
      '/root/workspace/src/main.ts',
    );
    expect(input.filename).toMatch(/^workspace-export-v\d+\.zip$/);
    expect(input.metadata.target).toBe('vue-page');
    expect(input.metadata.parentArtifactId).toBe('artifact-1');
    expect(JSON.parse(String(input.sourceText))).toMatchObject({
      framework: 'vue',
      files: { 'src/main.ts': 'export {};' },
    });
    expect(artifact.status).toBe('ready');

    await expect(
      service.destroyWorkspace('thread-1', 'owner-1', 'tenant-1', true),
    ).resolves.toEqual({ destroyed: true });
    expect(sandbox.kill).toHaveBeenCalledTimes(1);
    expect(
      redisValues.has(identityKey('tenant-1', 'owner-1', 'thread-1')),
    ).toBe(false);
  });

  it('reuses the output Artifact for a retried Coding Task', async () => {
    const existing = {
      id: 'artifact-coding-task-1',
      status: 'ready',
      metadata: { codingTaskId: 'coding-task-1' },
    };
    artifacts.listStudioVersions.mockResolvedValueOnce([existing]);
    artifacts.getStudioVersion.mockResolvedValueOnce({ tenantId: 'tenant-1' });

    await expect(
      service.exportWorkspace(
        'thread-1',
        'owner-1',
        'tenant-1',
        {
          taskId: 'coding-task-1',
          role: 'backend',
          parentRunId: 'workflow-run-1',
          traceId: 'coding-run-1',
        },
      ),
    ).resolves.toMatchObject({ id: 'artifact-coding-task-1' });
    expect(artifacts.createStudioVersion).not.toHaveBeenCalled();
    expect(createSandbox).not.toHaveBeenCalled();
  });

  it('compares workspace file hashes and preserves each declared verification exit code', async () => {
    redisValues.set(
      identityKey('tenant-1', 'owner-1', 'thread-1'),
      JSON.stringify(workspaceRecord()),
    );
    const seed = await new JSZip()
      .file('package.json', JSON.stringify({ scripts: { lint: 'lint', test: 'test', build: 'build' } }))
      .file('src/main.ts', 'seed source')
      .generateAsync({ type: 'nodebuffer' });
    artifacts.getStudioVersionFile.mockResolvedValue({ body: seed });
    const contents = new Map<string, Buffer>([
      ['/root/workspace/package.json', Buffer.from(JSON.stringify({ scripts: { lint: 'lint', test: 'test', build: 'build' } }))],
      ['/root/workspace/src/main.ts', Buffer.from('modified source')],
      ['/root/workspace/src/new.ts', Buffer.from('new source')],
    ]);
    sandbox.files.listDirectory.mockResolvedValue([
      { path: '/root/workspace/package.json', type: 'file', size: 80 },
      { path: '/root/workspace/src/main.ts', type: 'file', size: 15 },
      { path: '/root/workspace/src/new.ts', type: 'file', size: 10 },
    ]);
    sandbox.files.readBytes.mockImplementation(async (path: string) => contents.get(path)!);
    sandbox.commands.run
      .mockResolvedValueOnce({ exitCode: 0, logs: { stdout: [{ text: 'lint ok' }] } })
      .mockResolvedValueOnce({ exitCode: 2, logs: { stderr: [{ text: 'test failed' }] } })
      .mockResolvedValueOnce({ exitCode: 0, logs: { stdout: [{ text: 'build ok' }] } });

    const result = await service.verifyWorkspace(
      'thread-1',
      'owner-1',
      'tenant-1',
      'artifact-1',
    );

    expect(result.diff.added.map((file) => file.path)).toEqual(['src/new.ts']);
    expect(result.diff.modified.map((file) => file.path)).toEqual(['src/main.ts']);
    expect(result.diff.deleted).toEqual([]);
    expect(result.checks).toMatchObject({
      lint: { status: 'passed', command: 'npm run lint', exitCode: 0 },
      test: { status: 'failed', command: 'npm run test', exitCode: 2 },
      build: { status: 'passed', command: 'npm run build', exitCode: 0 },
    });
    expect(sandbox.commands.run).toHaveBeenCalledTimes(3);
  });

  it('marks missing package scripts as not applicable instead of passed', async () => {
    redisValues.set(
      identityKey('tenant-1', 'owner-1', 'thread-1'),
      JSON.stringify(workspaceRecord()),
    );
    const seed = await new JSZip()
      .file('src/main.ts', 'same source')
      .generateAsync({ type: 'nodebuffer' });
    artifacts.getStudioVersionFile.mockResolvedValue({ body: seed });
    sandbox.files.listDirectory.mockResolvedValue([
      { path: '/root/workspace/src/main.ts', type: 'file', size: 11 },
    ]);
    sandbox.files.readBytes.mockResolvedValue(Buffer.from('same source'));

    const result = await service.verifyWorkspace(
      'thread-1',
      'owner-1',
      'tenant-1',
      'artifact-1',
    );

    expect(result.diff).toEqual({ added: [], modified: [], deleted: [] });
    expect(Object.values(result.checks).map((check) => check.status)).toEqual([
      'not_applicable',
      'not_applicable',
      'not_applicable',
    ]);
    expect(sandbox.commands.run).not.toHaveBeenCalled();
  });
});
