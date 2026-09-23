import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RagClientService } from './rag-client.service';
import { resolveRagServiceToken } from './rag-service-token';

describe('RagClientService', () => {
  let service: RagClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagClientService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'RAG_SERVICE_BASE_URL') return 'http://localhost:3000/api/v1';
              if (key === 'RAG_SERVICE_TIMEOUT_MS') return '5000';
              if (key === 'RAG_SERVICE_TOKEN') return 'test-token';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<RagClientService>(RagClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return config', () => {
    const config = service.getConfig();
    expect(config.baseUrl).toBe('http://localhost:3000/api/v1');
    expect(config.timeoutMs).toBe(5000);
    expect(config.integration).toBe('http-api-contract');
  });

  describe('HTTP request', () => {
    let mockFetch: jest.Mock;

    beforeEach(() => {
      mockFetch = jest.fn();
      global.fetch = mockFetch;
    });

    it('should call fetch with Authorization header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: 200, data: { test: true } }),
      });

      const result = await service.getCapabilities();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/rag/admin/capabilities',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );

      expect(result.available).toBe(true);
      expect(result.status).toBe(200);
    });

    it('requests an internal speech ticket using the trusted service token and verified owner context', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { ticket: 'speech-ticket' } }),
      });

      await service.issueSpeechTicket('owner-1', 'user', 'tenant-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/auth/internal/speech-ticket',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'content-type': 'application/json',
          }),
          body: JSON.stringify({
            ownerUserId: 'owner-1',
            ownerRole: 'user',
            tenantId: 'tenant-1',
          }),
        }),
      );
    });

    it('should handle 401 error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ code: 401, message: 'unauthorized' }),
      });

      const result = await service.getCapabilities();

      expect(result.available).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toBeDefined();
    });

    it('should handle timeout', async () => {
      mockFetch.mockImplementation(() =>
        new Promise((_, reject) => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          setTimeout(() => reject(error), 100);
        }),
      );

      const result = await service.getCapabilities();

      expect(result.available).toBe(false);
      expect(result.error).toContain('abort');
    });

    it('should call search popular queries', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: {
              available: true,
              data: [{ query: 'test', count: 5 }],
            },
          }),
      });

      const result = await service.getSearchPopularQueries();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/rag/admin/search/queries/popular',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );

      expect(result.available).toBe(true);
    });

    it('should call qa negative feedback', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { available: true, data: [] },
          }),
      });

      const result = await service.getQaNegativeFeedback();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/rag/admin/qa/negative-feedback',
        expect.any(Object),
      );

      expect(result.available).toBe(true);
    });

    it('should call role presets catalog', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: {
              defaultRolePresetId: 'business-owner',
              roles: [{ id: 'business-owner', name: '业务负责人' }],
            },
          }),
      });

      const result = await service.getRolePresets();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/rag/admin/role-presets',
        expect.any(Object),
      );
      expect(result.available).toBe(true);
    });

    it('should call AG-UI admin stream with service token', async () => {
      const controller = new AbortController();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: {},
      });

      await service.streamAgui(
        {
          query: '测试 AG-UI',
          mode: 'agentic',
          userId: 'admin-user',
          rolePresetId: 'product-manager',
        },
        controller.signal,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/agui/admin/stream?query=%E6%B5%8B%E8%AF%95+AG-UI&mode=agentic&model=qwen&userId=admin-user&rolePresetId=product-manager',
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer test-token',
          },
          signal: controller.signal,
        }),
      );
    });

    it('should call graph schema', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { available: true, nodeCount: 0 },
          }),
      });

      const result = await service.getGraphSchema();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/rag/admin/graph/schema',
        expect.any(Object),
      );

      expect(result.available).toBe(true);
    });

    it('should call documents list', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { documents: [], total: 0 },
          }),
      });

      const result = await service.getDocuments({ page: 1, pageSize: 20 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/rag/admin/documents?page=1&pageSize=20',
        expect.any(Object),
      );

      expect(result.available).toBe(true);
    });

    it('should call download document', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { filename: 'test.pdf' },
          }),
      });

      const result = await service.downloadDocument('doc-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/rag/admin/documents/doc-123/download',
        expect.any(Object),
      );

      expect(result.available).toBe(true);
    });

    // ─── Error / Edge Case Tests ─────────────────────────────

    it('should handle malformed JSON from rag backend', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'not-json',
      });

      const result = await service.getCapabilities();
      expect(result.available).toBe(false);
      expect(result.error).toContain('not valid JSON');
    });

    it('should handle network failure gracefully', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      const result = await service.getCapabilities();
      expect(result.available).toBe(false);
      expect(result.status).toBe(null);
      expect(result.error).toContain('fetch failed');
    });

    it('should handle 503 from rag-backend', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ message: 'Service Unavailable' }),
      });

      const result = await service.getCapabilities();
      expect(result.available).toBe(false);
      expect(result.status).toBe(503);
    });

    // ─── Document Actions ────────────────────────────────────

    it('should call reindex document', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: 200, data: { success: true } }),
      });

      const result = await service.reindexDocument('doc-456');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/rag/admin/documents/doc-456/reindex',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result.available).toBe(true);
    });

    it('should call delete document', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: 200, data: { success: true } }),
      });

      const result = await service.deleteDocument('doc-789');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/rag/admin/documents/doc-789',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(result.available).toBe(true);
    });

    it('should call archive document', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: 200, data: { archived: true } }),
      });

      const result = await service.archiveDocument('doc-111');
      expect(result.available).toBe(true);
    });

    it('should call batch document operation', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: 200, data: { processed: 3 } }),
      });

      const result = await service.batchDocumentOperation({ ids: ['1', '2', '3'], action: 'delete' });
      expect(result.available).toBe(true);
    });

    // ─── Evaluation ──────────────────────────────────────────

    it('should call run evaluation', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: 200, data: { runId: 'eval-1', status: 'running' } }),
      });

      const result = await service.runEvaluation({
        dataset: 'ds-1',
        mode: 'offline' as any,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/rag/admin/evaluations/run',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('dataset'),
        }),
      );
      expect(result.available).toBe(true);
    });

    // ─── Graph Ops - disabled state ──────────────────────────

    it('should handle graph disabled (503) for entities', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ message: 'GraphRAG is disabled' }),
      });

      const result = await service.getGraphEntities();
      expect(result.available).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('should handle graph empty state', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          code: 200,
          data: { available: true, nodeCount: 0, data: [] },
        }),
      });

      const result = await service.getGraphSchema();
      expect(result.available).toBe(true);
      // The raw response body is wrapped in { code, data }
      expect(result.data).toHaveProperty('code');
    });

    // ─── Timeout/Abort ───────────────────────────────────────

    it('should handle AbortError for evaluations timeout', async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((_, reject) => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          }),
      );

      const result = await service.getEvaluations();
      expect(result.available).toBe(false);
      expect(result.data).toBeNull();
    });
  });
});

describe('resolveRagServiceToken', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalToken = process.env.RAG_SERVICE_TOKEN;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalToken === undefined) {
      delete process.env.RAG_SERVICE_TOKEN;
    } else {
      process.env.RAG_SERVICE_TOKEN = originalToken;
    }
  });

  it('uses configured service token first', () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'RAG_SERVICE_TOKEN' ? ' configured-token ' : undefined,
      ),
    } as unknown as ConfigService;

    expect(resolveRagServiceToken(config)).toBe('configured-token');
  });

  it('uses local dev token outside production when token is missing', () => {
    delete process.env.RAG_SERVICE_TOKEN;
    process.env.NODE_ENV = 'development';
    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;

    expect(resolveRagServiceToken(config)).toBe('local-rag-service-token');
  });

  it('fails fast in production when token is missing', () => {
    delete process.env.RAG_SERVICE_TOKEN;
    process.env.NODE_ENV = 'production';
    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;

    expect(() => resolveRagServiceToken(config)).toThrow(
      'RAG_SERVICE_TOKEN is required when NODE_ENV=production',
    );
  });
});
