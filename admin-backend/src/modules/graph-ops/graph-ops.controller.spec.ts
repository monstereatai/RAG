import { Test, TestingModule } from '@nestjs/testing';
import { RagClientService } from '../rag-client/rag-client.service';
import { GraphOpsController } from './graph-ops.controller';
import { GraphOpsMockService } from './graph-ops-mock.service';

describe('GraphOpsController', () => {
  let controller: GraphOpsController;
  let ragClient: RagClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GraphOpsController],
      providers: [
        GraphOpsMockService,
        {
          provide: RagClientService,
          useValue: {
            getGraphSchema: jest.fn(),
            getGraphEntities: jest.fn(),
            getGraphRelationships: jest.fn(),
            getGraphOrphans: jest.fn(),
            getGraphConflicts: jest.fn(),
            getGraphEntityDetail: jest.fn(),
            updateGraphEntity: jest.fn(),
            searchGraph: jest.fn(),
            searchGraphRelationships: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<GraphOpsController>(GraphOpsController);
    ragClient = module.get<RagClientService>(RagClientService);
  });

  it('unwraps nested RAG wrappers before returning relationship list', async () => {
    jest.spyOn(ragClient, 'searchGraphRelationships').mockResolvedValue({
      available: true,
      status: 200,
      data: {
        code: 200,
        data: {
          available: true,
          data: [{ id: 'rel-1', source: 'RAG', target: 'BM25', label: 'uses' }],
        },
      } as any,
    });

    await expect(controller.getRelations({ query: 'RAG' })).resolves.toMatchObject({
      data: [{ id: 'rel-1', source: 'RAG', target: 'BM25', label: 'uses' }],
      total: 1,
      meta: { source: 'rag-backend', demo: false },
    });
  });

  it('unwraps nested RAG wrappers before returning graph relation search result', async () => {
    jest.spyOn(ragClient, 'searchGraph').mockResolvedValue({
      available: true,
      status: 200,
      data: {
        code: 200,
        data: {
          available: true,
          data: {
            nodes: [{ id: 'RAG', label: 'RAG 系统', type: 'Concept' }],
            edges: [{ id: 'edge-1', source: 'RAG', target: 'Milvus', label: 'uses' }],
          },
        },
      } as any,
    });

    await expect(controller.searchRelations({ query: 'RAG' })).resolves.toMatchObject({
      data: {
        nodes: [{ id: 'RAG', label: 'RAG 系统', type: 'Concept' }],
        edges: [{ id: 'edge-1', source: 'RAG', target: 'Milvus', label: 'uses' }],
      },
      meta: { source: 'rag-backend', demo: false },
    });
  });

  it('counts real graph stats from unwrapped entity and relationship payloads', async () => {
    jest.spyOn(ragClient, 'getGraphEntities').mockResolvedValue({
      available: true,
      status: 200,
      data: {
        code: 200,
        data: {
          available: true,
          data: [
            { id: 'RAG', type: 'Concept', relationshipCount: 2 },
            { id: 'Milvus', type: 'Database', relationshipCount: 1 },
          ],
        },
      } as any,
    });
    jest.spyOn(ragClient, 'getGraphRelationships').mockResolvedValue({
      available: true,
      status: 200,
      data: {
        code: 200,
        data: {
          available: true,
          data: [{ id: 'edge-1', label: 'uses' }],
        },
      } as any,
    });
    jest.spyOn(ragClient, 'getGraphOrphans').mockResolvedValue({
      available: true,
      status: 200,
      data: { code: 200, data: { available: true, data: [] } } as any,
    });
    jest.spyOn(ragClient, 'getGraphConflicts').mockResolvedValue({
      available: true,
      status: 200,
      data: { code: 200, data: { available: true, data: [] } } as any,
    });

    await expect(controller.getStats()).resolves.toMatchObject({
      data: {
        nodeCount: 2,
        edgeCount: 1,
        entityTypes: [
          { type: 'Concept', count: 1 },
          { type: 'Database', count: 1 },
        ],
        relationTypes: [{ type: 'uses', count: 1 }],
      },
      meta: { source: 'rag-backend', demo: false },
    });
  });
});
