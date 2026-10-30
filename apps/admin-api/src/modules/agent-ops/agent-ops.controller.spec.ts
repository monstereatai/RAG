import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { REQUIRE_LOGIN_KEY } from '../../common/decorators/require-login.decorator';
import { REQUIRE_PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { RagClientService } from '../rag-client/rag-client.service';
import { AgentOpsController } from './agent-ops.controller';

describe('AgentOpsController workflow workspace preview proxy', () => {
  let app: Awaited<ReturnType<TestingModule['createNestApplication']>>;
  const ragClient = {
    proxyProductionWorkflowWorkspacePreview: jest.fn(),
    exportProductionWorkflowWorkspace: jest.fn(),
    deleteProductionWorkflowWorkspace: jest.fn(),
  };
  const controller = new AgentOpsController(ragClient as never);
  const ticket = 'ticket_' + 'a'.repeat(32);

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentOpsController],
      providers: [{ provide: RagClientService, useValue: ragClient }],
    }).compile();
    app = module.createNestApplication();
    app.use((_req, res, next) => {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      next();
    });
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers unauthenticated GET/HEAD ticket routes and confines preview HTML to a sandboxed origin', async () => {
    ragClient.proxyProductionWorkflowWorkspacePreview.mockImplementation(() =>
      Promise.resolve(new Response('<html><script>window.preview = true</script></html>', {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': 'default-src * unsafe-inline',
          'x-frame-options': 'DENY',
        },
      })),
    );

    const response = await request(app.getHttpServer())
      .get(`/api/admin/agent-ops/workflows/thread-1/workspace/preview/${ticket}/`)
      .set('Origin', 'null')
      .set('Authorization', 'Bearer browser-token')
      .set('Cookie', 'session=browser-cookie')
      .expect(200);

    expect(response.headers['content-security-policy']).toBe('sandbox allow-scripts');
    expect(response.headers['access-control-allow-origin']).toBe('null');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(response.headers['access-control-allow-methods']).toBe('GET, HEAD');
    expect(response.headers['x-frame-options']).toBeUndefined();
    expect(ragClient.proxyProductionWorkflowWorkspacePreview).toHaveBeenCalledWith(
      ticket,
      'thread-1',
      expect.objectContaining({
        method: 'GET',
        path: '',
        query: '',
        signal: expect.any(AbortSignal),
      }),
    );
    const forwardedHeaders = ragClient.proxyProductionWorkflowWorkspacePreview.mock.calls[0][2]
      .headers;
    expect(forwardedHeaders).not.toHaveProperty('authorization');
    expect(forwardedHeaders).not.toHaveProperty('cookie');

    await request(app.getHttpServer())
      .head(`/api/admin/agent-ops/workflows/thread-1/workspace/preview/${ticket}/`)
      .expect(200);
    expect(ragClient.proxyProductionWorkflowWorkspacePreview).toHaveBeenLastCalledWith(
      ticket,
      'thread-1',
      expect.objectContaining({ method: 'HEAD', path: '' }),
    );
    await request(app.getHttpServer())
      .post(`/api/admin/agent-ops/workflows/thread-1/workspace/preview/${ticket}/`)
      .expect(404);
  });

  it('registers the Nest 10 wildcard route and preserves path and raw query for RAG', async () => {
    ragClient.proxyProductionWorkflowWorkspacePreview.mockImplementation(() =>
      Promise.resolve(new Response('console.log("preview")', {
        status: 200,
        headers: { 'content-type': 'text/javascript' },
      })),
    );

    await request(app.getHttpServer())
      .get(
        `/api/admin/agent-ops/workflows/thread-2/workspace/preview/${ticket}/assets/main.js?v=1&label=hello+world`,
      )
      .set('Origin', 'null')
      .set('Authorization', 'Bearer browser-token')
      .set('Cookie', 'session=browser-cookie')
      .expect(200);

    expect(ragClient.proxyProductionWorkflowWorkspacePreview).toHaveBeenCalledWith(
      ticket,
      'thread-2',
      expect.objectContaining({
        method: 'GET',
        path: 'assets/main.js',
        query: 'v=1&label=hello+world',
      }),
    );
  });

  it.each([
    ['text/html; charset=utf-8', '<html></html>'],
    ['image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    ['application/xml', '<root />'],
    ['text/xml; charset=utf-8', '<root />'],
    ['application/problem+xml', '<problem />'],
    ['application/xhtml+xml', '<html xmlns="http://www.w3.org/1999/xhtml"></html>'],
  ])('forces a sandbox CSP for preview document MIME type %s', async (contentType, body) => {
    ragClient.proxyProductionWorkflowWorkspacePreview.mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: {
          'content-type': contentType,
          'content-security-policy': 'default-src * unsafe-inline',
        },
      }),
    );

    const response = await request(app.getHttpServer())
      .get(`/api/admin/agent-ops/workflows/thread-1/workspace/preview/${ticket}/`)
      .expect(200);

    expect(response.headers['content-security-policy']).toBe('sandbox allow-scripts');
  });

  it('uses read permission for status and write permission to mint tickets', () => {
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.workflowWorkspace),
    ).toEqual(['admin:qa-ops:read']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        controller.createWorkflowWorkspacePreviewTicket,
      ),
    ).toEqual(['admin:qa-ops:write']);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.deleteWorkflowWorkspace),
    ).toEqual(['admin:qa-ops:write']);
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSION_KEY, controller.exportWorkflowWorkspace),
    ).toEqual(['admin:qa-ops:write']);
    expect(
      Reflect.getMetadata(REQUIRE_LOGIN_KEY, controller.previewWorkflowWorkspacePath),
    ).toBe(false);
    expect(
      Reflect.getMetadata(REQUIRE_LOGIN_KEY, controller.headWorkflowWorkspacePreviewPath),
    ).toBe(false);
  });

  it('requires explicit confirmation before discarding workspace changes', async () => {
    const req = { user: { userId: '42' } };

    expect(() =>
      controller.deleteWorkflowWorkspace(
        'thread-1',
        { confirmDiscard: false },
        req as never,
      ),
    ).toThrow('confirmDiscard must be true');
    expect(ragClient.deleteProductionWorkflowWorkspace).not.toHaveBeenCalled();

    ragClient.deleteProductionWorkflowWorkspace.mockResolvedValue({
      available: true,
      status: 200,
      data: { deleted: true },
    });
    await expect(
      controller.deleteWorkflowWorkspace(
        'thread-1',
        { confirmDiscard: true },
        req as never,
      ),
    ).resolves.toEqual({ available: true, status: 200, data: { deleted: true } });
    expect(ragClient.deleteProductionWorkflowWorkspace).toHaveBeenCalledWith(
      'thread-1',
      '42',
      undefined,
      { confirmDiscard: true },
    );
  });

  it('returns the JSON export artifact metadata for the existing download flow', async () => {
    const result = {
      available: true,
      status: 200,
      data: { artifact: { id: 'artifact-1' } },
    };
    ragClient.exportProductionWorkflowWorkspace.mockResolvedValue(result);

    await expect(
      controller.exportWorkflowWorkspace(
        'thread-1',
        { user: { userId: '42' } } as never,
      ),
    ).resolves.toEqual(result);
    expect(ragClient.exportProductionWorkflowWorkspace).toHaveBeenCalledWith(
      'thread-1',
      '42',
      undefined,
    );
  });
});
