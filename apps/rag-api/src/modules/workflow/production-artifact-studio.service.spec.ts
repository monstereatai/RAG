import JSZip from 'jszip';
import { ProductionArtifactStudioService } from './production-artifact-studio.service';

const activitySchema = {
  schemaVersion: 1,
  kind: 'activity-page-schema',
  projectId: 'act-demo',
  title: '活动页',
  components: [],
  apis: [],
  events: [],
  rules: [],
  checks: [],
  notes: [],
};

describe('ProductionArtifactStudioService', () => {
  const context = {
    threadId: 'thread-1',
    projectId: 'act-demo',
    status: 'completed',
    selectedRoles: ['product'],
    completedRoles: ['product'],
    brief: '活动页需求',
    stages: [
      {
        role: 'product',
        lowCodeSchemas: [
          {
            schemaVersion: 1,
            kind: 'pageSchema',
            title: '页面骨架',
            components: [{ id: 'hero', type: 'banner', name: '活动主视觉' }],
            apis: [],
            events: [],
            rules: [],
            checks: [],
            notes: [],
          },
        ],
      },
    ],
  };

  const setup = () => {
    const workflows = {
      codingContext: jest.fn().mockResolvedValue(context),
    };
    const created: Array<Record<string, unknown>> = [];
    const artifacts = {
      listStudioVersions: jest.fn().mockResolvedValue([]),
      createStudioVersion: jest.fn((input: Record<string, unknown>) => {
        created.push(input);
        return {
          id: `artifact-${created.length}`,
          title: input.title,
          kind: input.kind,
          status: 'ready',
          filename: input.filename,
          size: (input.body as Buffer).length,
          createdAt: new Date().toISOString(),
          metadata: { studio: 'production', ...(input.metadata as object) },
          sourceText: input.sourceText,
        };
      }),
      getStudioVersion: jest.fn(),
      getStudioVersionFile: jest.fn(),
      updateStudioVersionMetadata: jest.fn(),
    };
    const llm = {
      invoke: jest.fn(),
      getActiveProviderName: jest.fn(),
      getFallbackProviderName: jest.fn(),
    };
    const config = { get: jest.fn().mockReturnValue('http://127.0.0.1:4321') };
    const service = new ProductionArtifactStudioService(
      workflows as never,
      artifacts as never,
      llm as never,
      config as never,
    );
    return { service, workflows, artifacts, created, llm };
  };

  it('creates each selected schema and code target in one multi-select request', async () => {
    const { service, created } = setup();
    const targets = [
      'activity-schema',
      'vue-page',
      'react-page',
      'dashboard-schema',
      'vue-dashboard',
      'react-dashboard',
    ] as const;

    const result = await service.generate('thread-1', 'owner-1', undefined, [
      ...targets,
    ]);

    expect(result.selectedTargets).toEqual(targets);
    expect(result.items).toHaveLength(6);
    expect(
      created.map(
        (item) =>
          item.metadata && (item.metadata as Record<string, unknown>).target,
      ),
    ).toEqual([
      'activity-schema',
      'dashboard-schema',
      'vue-page',
      'react-page',
      'vue-dashboard',
      'react-dashboard',
    ]);
    const codeArtifact = created.find((item) => item.kind === 'code');
    const codeSource = JSON.parse(String(codeArtifact?.sourceText)) as {
      framework: string;
      files: Record<string, string>;
    };
    expect(codeSource.framework).toBe('vue');
    expect(codeSource.files['src/App.vue']).toContain('活动主视觉');
  });

  it('proposes a validated edit and returns a field diff without saving a version', async () => {
    const { service, artifacts, llm, created } = setup();
    artifacts.getStudioVersion.mockResolvedValue({
      id: 'schema-v1',
      kind: 'json',
      sourceText: JSON.stringify(activitySchema),
      metadata: JSON.stringify({ target: 'activity-schema' }),
    });
    llm.invoke.mockResolvedValue(
      JSON.stringify({ ...activitySchema, title: '春季预约活动' }),
    );

    const draft = await service.proposeEdit(
      'thread-1',
      'owner-1',
      'activity-schema',
      'schema-v1',
      '修改页面标题',
    );

    expect(draft.diff).toEqual([
      { path: '$.title', before: '活动页', after: '春季预约活动' },
    ]);
    expect(created).toHaveLength(0);
  });

  it('applies a Schema edit as a new version and regenerates selected code', async () => {
    const { service, artifacts, created } = setup();
    artifacts.getStudioVersion.mockResolvedValue({
      id: 'schema-v1',
      kind: 'json',
      sourceText: JSON.stringify(activitySchema),
      metadata: JSON.stringify({ target: 'activity-schema', version: 1 }),
    });
    artifacts.listStudioVersions.mockResolvedValue([
      {
        id: 'schema-v1',
        status: 'ready',
        metadata: {
          studio: 'production',
          target: 'activity-schema',
          version: 1,
        },
      },
    ]);

    const result = await service.applyEdit('thread-1', 'owner-1', undefined, {
      target: 'activity-schema',
      baseArtifactId: 'schema-v1',
      schema: { ...activitySchema, title: '春季预约活动' },
      regenerateTargets: ['vue-page'],
    });

    expect(result.items).toHaveLength(2);
    expect(created[0].metadata).toEqual(
      expect.objectContaining({
        target: 'activity-schema',
        version: 2,
        parentArtifactId: 'schema-v1',
      }),
    );
    expect(created[1].metadata).toEqual(
      expect.objectContaining({
        target: 'vue-page',
        schemaArtifactId: 'artifact-1',
      }),
    );
  });

  it('restores an older Schema as a new version', async () => {
    const { service, artifacts, created } = setup();
    artifacts.getStudioVersion.mockResolvedValue({
      id: 'schema-v1',
      kind: 'json',
      sourceText: JSON.stringify(activitySchema),
      metadata: JSON.stringify({ target: 'activity-schema', version: 1 }),
    });
    artifacts.listStudioVersions.mockResolvedValue([
      {
        id: 'schema-v1',
        status: 'ready',
        metadata: {
          studio: 'production',
          target: 'activity-schema',
          version: 3,
        },
      },
    ]);

    await service.restore('thread-1', 'owner-1', undefined, 'schema-v1');

    expect(created[0].metadata).toEqual(
      expect.objectContaining({
        target: 'activity-schema',
        version: 4,
        parentArtifactId: 'schema-v1',
        restoredFromArtifactId: 'schema-v1',
      }),
    );
  });

  it('returns an explicitly simulated stable sync object and records the actor', async () => {
    const { service, artifacts } = setup();
    const version = {
      id: 'schema-v1',
      kind: 'json',
      sourceText: JSON.stringify(activitySchema),
      metadata: JSON.stringify({ target: 'activity-schema', version: 1 }),
    };
    artifacts.getStudioVersion.mockResolvedValue(version);
    artifacts.updateStudioVersionMetadata.mockResolvedValue({
      id: 'schema-v1',
    });

    const result = await service.simulateSync(
      'thread-1',
      'owner-1',
      'schema-v1',
    );
    const repeated = await service.simulateSync(
      'thread-1',
      'owner-1',
      'schema-v1',
    );

    expect(result.simulated).toBe(true);
    expect(result.platform).toBe('模拟低代码平台');
    expect(result.mode).toBe('draft');
    expect(result.objectId).toMatch(/^sim-/);
    expect(repeated.objectId).toBe(result.objectId);
    expect(artifacts.updateStudioVersionMetadata).toHaveBeenCalledWith(
      'schema-v1',
      'owner-1',
      'thread-1',
      expect.objectContaining({
        simulatedSyncAudit: [
          expect.objectContaining({ actorUserId: 'owner-1' }),
        ],
      }),
    );
  });

  it('sends only fixed source files to the preview runner', async () => {
    const { service, artifacts } = setup();
    artifacts.getStudioVersion.mockResolvedValue({
      id: 'vue-page-v1',
      kind: 'code',
      status: 'ready',
      sourceText: JSON.stringify({
        framework: 'vue',
        files: {
          'index.html': '<html></html>',
          'package.json': '{}',
          'vite.config.ts': 'export default {}',
          'src/main.ts': "createApp(App).mount('#app')",
          'src/App.vue': '<template><h1>活动页</h1></template>',
          'src/style.css': 'h1 { color: red; }',
        },
      }),
      metadata: JSON.stringify({ target: 'vue-page', version: 1 }),
    });
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ html: '<h1>活动页</h1>' }), {
        status: 200,
      }),
    );

    try {
      const result = await service.preview(
        'thread-1',
        'owner-1',
        'vue-page-v1',
      );
      const requestBodyText = fetchSpy.mock.calls[0][1]?.body;
      if (typeof requestBodyText !== 'string') {
        throw new Error('Preview request body was not serialized JSON.');
      }
      const requestBody = JSON.parse(requestBodyText) as {
        framework: string;
        files: Record<string, string>;
      };

      expect(result.build).toBe('isolated-preview-runner');
      expect(Object.keys(requestBody.files).sort()).toEqual([
        'src/App.vue',
        'src/main.ts',
        'src/style.css',
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('proposes direct code edits with a compiled preview without saving', async () => {
    const { service, artifacts, llm, created } = setup();
    artifacts.getStudioVersion.mockResolvedValue({
      id: 'vue-page-v1',
      kind: 'code',
      status: 'ready',
      sourceText: JSON.stringify({
        framework: 'vue',
        files: {
          'index.html': '<html></html>',
          'package.json': '{}',
          'vite.config.ts': 'export default {}',
          'src/main.ts': "import App from './App.vue';",
          'src/App.vue': '<template><h1>活动页</h1></template>',
          'src/style.css': 'h1 { color: red; }',
        },
      }),
      metadata: JSON.stringify({ target: 'vue-page', version: 1 }),
    });
    llm.invoke.mockResolvedValue(
      JSON.stringify({
        files: { 'src/App.vue': '<template><main>春季活动</main></template>' },
      }),
    );
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ html: '<main>春季活动</main>' }), {
        status: 200,
      }),
    );

    try {
      const draft = await service.proposeCodeEdit(
        'thread-1',
        'owner-1',
        'vue-page-v1',
        '把标题改成春季活动',
      );
      const requestBodyText = fetchSpy.mock.calls[0][1]?.body;
      if (typeof requestBodyText !== 'string') {
        throw new Error('Preview request body was not serialized JSON.');
      }
      const requestBody = JSON.parse(requestBodyText) as {
        files: Record<string, string>;
      };

      expect(draft.diff).toEqual([
        {
          path: 'src/App.vue',
          before: '<template><h1>活动页</h1></template>',
          after: '<template><main>春季活动</main></template>',
        },
      ]);
      expect(draft.previewHtml).toContain('春季活动');
      expect(Object.keys(requestBody.files).sort()).toEqual([
        'src/App.vue',
        'src/main.ts',
        'src/style.css',
      ]);
      expect(created).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('saves applied code edits as a new ZIP version without changing its Schema', async () => {
    const { service, artifacts, created } = setup();
    const originalZip = new JSZip();
    originalZip.file('README.md', '# Generated project\n');
    originalZip.file(
      'schemas/LOW_CODE_SCHEMA.json',
      JSON.stringify(activitySchema),
    );
    originalZip.file('src/App.vue', '<template><h1>活动页</h1></template>');
    const originalBody = await originalZip.generateAsync({
      type: 'nodebuffer',
    });
    const base = {
      id: 'vue-page-v1',
      kind: 'code',
      status: 'ready',
      sourceText: JSON.stringify({
        framework: 'vue',
        files: {
          'index.html': '<html></html>',
          'package.json': '{}',
          'vite.config.ts': 'export default {}',
          'src/main.ts': "import App from './App.vue';",
          'src/App.vue': '<template><h1>活动页</h1></template>',
          'src/style.css': 'h1 { color: red; }',
        },
      }),
      metadata: JSON.stringify({
        target: 'vue-page',
        version: 1,
        schemaArtifactId: 'activity-schema-v1',
      }),
    };
    artifacts.getStudioVersion.mockResolvedValue(base);
    artifacts.getStudioVersionFile.mockResolvedValue({ body: originalBody });
    artifacts.listStudioVersions.mockResolvedValue([
      {
        id: base.id,
        status: 'ready',
        metadata: { target: 'vue-page', version: 1 },
      },
    ]);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ html: '<main>春季活动</main>' }), {
        status: 200,
      }),
    );

    try {
      const result = await service.applyCodeEdit(
        'thread-1',
        'owner-1',
        undefined,
        {
          baseArtifactId: 'vue-page-v1',
          instruction: '把标题改成春季活动',
          files: {
            'src/App.vue': '<template><main>春季活动</main></template>',
          },
        },
      );
      const savedZip = await JSZip.loadAsync(created[0].body as Buffer);
      const savedSource = JSON.parse(String(created[0].sourceText)) as {
        files: Record<string, string>;
      };

      expect(result.schemaOutOfSync).toBe(true);
      expect(created[0].filename).toBe('vue-page-v2.zip');
      expect(created[0].metadata).toEqual(
        expect.objectContaining({
          parentArtifactId: 'vue-page-v1',
          schemaArtifactId: 'activity-schema-v1',
          sourceEdited: true,
          schemaOutOfSync: true,
          editedByUserId: 'owner-1',
        }),
      );
      expect(savedSource.files['src/App.vue']).toContain('春季活动');
      expect(
        await savedZip.file('schemas/LOW_CODE_SCHEMA.json')?.async('string'),
      ).toBe(JSON.stringify(activitySchema));
      expect(await savedZip.file('README.md')?.async('string')).toContain(
        '代码可能与 Schema 不一致',
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('renders dashboard Schema data without connecting a real data source', async () => {
    const { service, artifacts } = setup();
    artifacts.getStudioVersion.mockResolvedValue({
      id: 'dashboard-v1',
      kind: 'json',
      status: 'ready',
      sourceText: JSON.stringify({
        schemaVersion: 1,
        kind: 'dashboard-schema',
        projectId: 'act-demo',
        title: '活动数据大屏',
        dataMode: 'mock',
        layout: { columns: 12, refreshSeconds: 60 },
        widgets: [
          {
            id: 'visitors',
            kind: 'bar',
            title: '演示趋势',
            labels: ['周一', '周二'],
            values: [20, 40],
          },
        ],
        notes: [],
      }),
      metadata: JSON.stringify({ target: 'dashboard-schema', version: 1 }),
    });

    const result = await service.preview('thread-1', 'owner-1', 'dashboard-v1');

    expect(result.html).toContain('模拟数据');
    expect(result.html).toContain('height:50%');
    expect(result.html).toContain('周一');
    expect(result.html).toContain("connect-src 'none'");
  });
});
