import { GraphService } from './graph.service';
import type { Neo4jProvider } from '../../providers/neo4j/neo4j.provider';
import type { GraphExtractorService } from '../structured/graph-extractor.service';
import type { LlmProvider } from '../../providers/llm/llm.provider';

describe('GraphService governance metadata', () => {
  function createService() {
    const executeWrite = jest
      .fn<Promise<void>, [string, Record<string, unknown>]>()
      .mockResolvedValue(undefined);
    const neo4jProvider = {
      isEnabled: jest.fn().mockReturnValue(true),
      executeRead: jest.fn(),
      executeWrite,
    } as unknown as Neo4jProvider;
    const graphExtractor = {
      extractFromText: jest.fn().mockResolvedValue({
        nodes: [
          {
            id: 'Atlas Knowledge Base',
            label: 'Product',
            properties: { aliases: 'AKB, 企业知识库' },
          },
          {
            id: 'Redis',
            label: 'Technology',
            properties: {},
          },
        ],
        relationships: [
          {
            source: 'Atlas Knowledge Base',
            target: 'Redis',
            type: 'DEPENDS_ON',
            properties: { confidence: '0.82' },
          },
        ],
      }),
    } as unknown as GraphExtractorService;
    const llmProvider = {
      invoke: jest.fn().mockResolvedValue('answer'),
      getModel: jest.fn(),
    } as unknown as LlmProvider;

    return {
      service: new GraphService(neo4jProvider, graphExtractor, llmProvider),
      neo4jProvider,
      executeWrite,
    };
  }

  it('writes aliases and relationship confidence into Neo4j payloads', async () => {
    const { service, executeWrite } = createService();

    await service.importText('AKB 依赖 Redis。', 'user-1', 'source-1');

    const [nodeCypher, nodePayload] = executeWrite.mock.calls[4];
    const [relationshipCypher, relationshipPayload] =
      executeWrite.mock.calls[5];
    expect(nodeCypher).toContain('n.aliases = node.aliases');
    expect(nodeCypher).toContain('n.sourceIds = CASE');
    expect(nodePayload).toMatchObject({
      nodes: [
        {
          id: 'Atlas Knowledge Base',
          aliases: ['AKB', '企业知识库'],
        },
        {
          id: 'Redis',
          aliases: [],
        },
      ],
    });
    expect(relationshipCypher).toContain('r.confidence = rel.confidence');
    expect(relationshipCypher).toContain('r.sourceIds = CASE');
    expect(relationshipPayload).toMatchObject({
      relationships: [
        {
          confidence: 0.82,
        },
      ],
    });
  });

  it('clears only the requested source and preserves other source ids', async () => {
    const { service, executeWrite } = createService();

    await service.removeSource('source-1', 'user-1');

    expect(executeWrite).toHaveBeenCalledTimes(4);
    expect(executeWrite.mock.calls[0][0]).toContain('DELETE r');
    expect(executeWrite.mock.calls[1][0]).toContain('r.sourceIds = remaining');
    expect(executeWrite.mock.calls[2][0]).toContain('n.sourceIds = remaining');
    expect(executeWrite.mock.calls[3][0]).toContain('DELETE n');
  });
});
