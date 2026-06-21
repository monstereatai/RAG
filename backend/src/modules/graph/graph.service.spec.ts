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

    const [nodeCypher, nodePayload] = executeWrite.mock.calls[0];
    const [relationshipCypher, relationshipPayload] =
      executeWrite.mock.calls[1];
    expect(nodeCypher).toContain('n.aliases = node.aliases');
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
    expect(relationshipPayload).toMatchObject({
      relationships: [
        {
          confidence: 0.82,
        },
      ],
    });
  });
});
