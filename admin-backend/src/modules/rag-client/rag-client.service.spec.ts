import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RagClientService } from './rag-client.service';

describe('RagClientService', () => {
  let service: RagClientService;
  let configService: ConfigService;

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
    configService = module.get<ConfigService>(ConfigService);
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
        },
        controller.signal,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/agui/admin/stream?query=%E6%B5%8B%E8%AF%95+AG-UI&mode=agentic&userId=admin-user',
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
  });
});
