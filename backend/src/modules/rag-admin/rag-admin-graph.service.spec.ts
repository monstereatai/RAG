import { NotFoundException } from '@nestjs/common';
import { RagAdminGraphService } from './rag-admin-graph.service';

describe('RagAdminGraphService', () => {
  const graphService = {
    isEnabled: jest.fn(),
    getSchema: jest.fn(),
    listEntities: jest.fn(),
    getEntityDetail: jest.fn(),
    updateEntity: jest.fn(),
    listRelationships: jest.fn(),
    getOrphanEntities: jest.fn(),
  };
  const factConflictRepo = { find: jest.fn() };
  const service = new RagAdminGraphService(
    graphService as never,
    factConflictRepo as never,
  );

  beforeEach(() => jest.resetAllMocks());

  it('returns an explicit disabled state without calling graph queries', async () => {
    graphService.isEnabled.mockReturnValue(false);

    await expect(service.getGraphSchema()).resolves.toEqual({
      available: false,
      data: {
        enabled: false,
        nodeCount: 0,
        relationshipCount: 0,
        labels: [],
        relationshipTypes: [],
      },
      error: 'GraphRAG is disabled',
    });
    expect(graphService.getSchema).not.toHaveBeenCalled();
  });

  it('preserves the admin scope and query when listing graph entities', async () => {
    const items = [{ id: 'entity-1' }];
    graphService.isEnabled.mockReturnValue(true);
    graphService.listEntities.mockResolvedValue(items);

    await expect(
      service.getGraphEntities({ keyword: 'project-x', limit: 5 }),
    ).resolves.toEqual({ available: true, data: items, total: 1 });
    expect(graphService.listEntities).toHaveBeenCalledWith('admin', {
      keyword: 'project-x',
      limit: 5,
    });
  });

  it('adds relationship endpoints to graph search results when nodes were not returned', async () => {
    graphService.isEnabled.mockReturnValue(true);
    graphService.listEntities.mockResolvedValue([{ id: 'known' }]);
    graphService.listRelationships.mockResolvedValue([
      {
        source: 'known',
        target: 'missing',
        targetLabel: 'Missing entity',
        targetType: 'project',
        sourceLabel: 'Known entity',
        sourceType: 'project',
        sourceId: 'doc-1',
        confidence: 0.9,
        updatedAt: new Date('2026-01-01'),
      },
    ]);

    const result = await service.searchGraph({ query: 'known', limit: 8 });

    expect(result).toMatchObject({
      available: true,
      data: {
        nodes: [
          { id: 'known' },
          { id: 'missing', label: 'Missing entity', type: 'project' },
        ],
        edges: [{ source: 'known', target: 'missing' }],
      },
    });
    expect(graphService.listEntities).toHaveBeenCalledWith('*', {
      keyword: 'known',
      limit: 8,
    });
    expect(graphService.listRelationships).toHaveBeenCalledWith('*', {
      query: 'known',
      limit: 8,
    });
  });

  it('returns graph conflicts in the existing API shape', async () => {
    factConflictRepo.find.mockResolvedValue([
      {
        id: 'conflict-1',
        subject: 'project-x',
        predicate: 'owner',
        currentValue: 'team-a',
        conflictingValue: 'team-b',
        currentVersion: 'v1',
        conflictingVersion: 'v2',
        status: 'open',
        sourceAuthority: 'approved',
        docId: 'doc-2',
        createdAt: new Date('2026-02-03T00:00:00.000Z'),
      },
    ]);

    await expect(service.getGraphConflicts()).resolves.toMatchObject({
      available: true,
      total: 1,
      data: [
        {
          id: 'conflict-1',
          source: 'project-x',
          target: 'team-b',
          createdAt: '2026-02-03T00:00:00.000Z',
        },
      ],
    });
    expect(factConflictRepo.find).toHaveBeenCalledWith({
      order: { createdAt: 'DESC' },
      take: 100,
    });
  });

  it('keeps missing graph entity updates as 404s', async () => {
    graphService.isEnabled.mockReturnValue(true);
    graphService.updateEntity.mockResolvedValue(null);

    await expect(
      service.updateGraphEntity('missing', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
