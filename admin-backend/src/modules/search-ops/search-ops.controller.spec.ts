import { Test, TestingModule } from '@nestjs/testing';
import { SearchOpsController } from './search-ops.controller';
import { RagClientService } from '../rag-client/rag-client.service';

describe('SearchOpsController', () => {
  let controller: SearchOpsController;
  let ragClient: RagClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SearchOpsController],
      providers: [
        {
          provide: RagClientService,
          useValue: {
            getSearchPopularQueries: jest.fn(),
            getSearchNoResultQueries: jest.fn(),
            getSearchRecallIssues: jest.fn(),
            searchDocuments: jest.fn(),
            getDocumentSearchFacets: jest.fn(),
            reindexDocumentSearch: jest.fn(),
            searchGraph: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<SearchOpsController>(SearchOpsController);
    ragClient = module.get<RagClientService>(RagClientService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('overview', () => {
    it('should return available status when all upstreams are available', async () => {
      jest.spyOn(ragClient, 'getSearchPopularQueries').mockResolvedValue({
        available: true,
        status: 200,
        data: [{ query: 'test', count: 5 }] as any,
      });

      jest.spyOn(ragClient, 'getSearchNoResultQueries').mockResolvedValue({
        available: true,
        status: 200,
        data: [] as any,
      });

      jest.spyOn(ragClient, 'getSearchRecallIssues').mockResolvedValue({
        available: true,
        status: 200,
        data: [] as any,
      });

      const result = await controller.overview();

      expect(result.status).toBe('available');
      expect(result.data.popularQueries).toEqual([{ query: 'test', count: 5 }]);
      expect(result.data.noResultQueries).toEqual([]);
      expect(result.data.recallIssues).toEqual([]);
    });

    it('should return partial status when some upstreams are unavailable', async () => {
      jest.spyOn(ragClient, 'getSearchPopularQueries').mockResolvedValue({
        available: true,
        status: 200,
        data: [] as any,
      });

      jest.spyOn(ragClient, 'getSearchNoResultQueries').mockResolvedValue({
        available: false,
        status: 401,
        data: null,
        error: 'unauthorized',
      });

      jest.spyOn(ragClient, 'getSearchRecallIssues').mockResolvedValue({
        available: false,
        status: 500,
        data: null,
        error: 'server error',
      });

      const result = await controller.overview();

      expect(result.status).toBe('partial');
    });

    it('should return unavailable status when all upstreams fail', async () => {
      jest.spyOn(ragClient, 'getSearchPopularQueries').mockResolvedValue({
        available: false,
        status: 401,
        data: null,
        error: 'unauthorized',
      });

      jest.spyOn(ragClient, 'getSearchNoResultQueries').mockResolvedValue({
        available: false,
        status: 401,
        data: null,
        error: 'unauthorized',
      });

      jest.spyOn(ragClient, 'getSearchRecallIssues').mockResolvedValue({
        available: false,
        status: 401,
        data: null,
        error: 'unauthorized',
      });

      const result = await controller.overview();

      expect(result.status).toBe('unavailable');
      expect(result.data.popularQueries).toEqual([]);
      expect(result.data.noResultQueries).toEqual([]);
      expect(result.data.recallIssues).toEqual([]);
    });
  });

  describe('getPopularQueries', () => {
    it('should return popular queries', async () => {
      jest.spyOn(ragClient, 'getSearchPopularQueries').mockResolvedValue({
        available: true,
        status: 200,
        data: [
          { query: 'NestJS', count: 10, avgLatencyMs: 500 },
          { query: 'LangChain', count: 5, avgLatencyMs: 300 },
        ] as any,
      });

      const result = await controller.getPopularQueries();

      expect(result.available).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });

  describe('getNoResultQueries', () => {
    it('should return no-result queries', async () => {
      jest.spyOn(ragClient, 'getSearchNoResultQueries').mockResolvedValue({
        available: true,
        status: 200,
        data: [{ query: 'unknown topic', count: 3 }] as any,
      });

      const result = await controller.getNoResultQueries();

      expect(result.available).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getRecallIssues', () => {
    it('should return recall issues', async () => {
      jest.spyOn(ragClient, 'getSearchRecallIssues').mockResolvedValue({
        available: true,
        status: 200,
        data: [{ query: 'test', count: 2, avgCitations: 0 }] as any,
      });

      const result = await controller.getRecallIssues();

      expect(result.available).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('search response boundary', () => {
    it('should unwrap the RAG response before returning document results', async () => {
      jest.spyOn(ragClient, 'searchDocuments').mockResolvedValue({
        available: true,
        status: 200,
        data: { code: 200, data: [{ docId: 'doc-1', filename: 'rag.md' }] } as any,
      });

      await expect(controller.searchDocuments('RAG', '20')).resolves.toEqual([
        { docId: 'doc-1', filename: 'rag.md' },
      ]);
    });

    it('should unwrap the RAG response before returning graph data', async () => {
      jest.spyOn(ragClient, 'searchGraph').mockResolvedValue({
        available: true,
        status: 200,
        data: {
          code: 200,
          data: { available: true, data: { nodes: [{ id: 'RAG' }], edges: [] } },
        } as any,
      });

      await expect(controller.searchGraph('RAG', '100')).resolves.toEqual({
        nodes: [{ id: 'RAG' }],
        edges: [],
      });
    });
  });
});
