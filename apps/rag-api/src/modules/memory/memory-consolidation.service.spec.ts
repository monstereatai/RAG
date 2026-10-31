/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { MemoryConsolidationService } from './memory-consolidation.service';
import type { Mem0MemoryResult } from '../../providers/mem0/mem0.provider';

const sourceMemory = (index: number): Mem0MemoryResult => ({
  id: `source-${index}`,
  memory: `Long-term user fact ${index}`,
  metadata: {
    rag_memory_scope: 'user',
    rag_recorded_at: `2026-01-${String(index).padStart(2, '0')}T00:00:00.000Z`,
  },
});

const fingerprint = (memory: Mem0MemoryResult): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        id: memory.id,
        memory: memory.memory,
        recordedAt: memory.metadata?.rag_recorded_at ?? null,
        validUntil: memory.metadata?.rag_valid_until ?? null,
        supersededAt: memory.metadata?.rag_superseded_at ?? null,
      }),
    )
    .digest('hex');

const createFixture = (enabled = true) => {
  const sources = Array.from({ length: 20 }, (_, index) =>
    sourceMemory(index + 1),
  );
  const proposal: Mem0MemoryResult = {
    id: 'proposal-1',
    memory: 'Reviewed summary',
    metadata: {
      rag_memory_scope: 'user',
      rag_memory_kind: 'consolidation',
      rag_consolidation_status: 'pending_review',
      rag_consolidation_created_at: '2026-10-31T00:00:00.000Z',
      rag_consolidation_prompt_version: 'sha256:test',
      rag_consolidation_sources: sources.map((source) => ({
        id: source.id,
        fingerprint: fingerprint(source),
      })),
    },
  };
  const builder = {
    select: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
  };
  const add = jest.fn().mockResolvedValue(undefined);
  const invoke = jest
    .fn()
    .mockResolvedValue({ summary: 'Generated stable facts' });
  const mem0Provider = {
    isEnabled: jest.fn().mockReturnValue(true),
    getAll: jest.fn().mockResolvedValue(sources),
    add,
    updateMetadata: jest.fn().mockResolvedValue(undefined),
  };
  const redis = {
    isEnabled: jest.fn().mockReturnValue(true),
    getRequired: jest.fn().mockResolvedValue(null),
    setIfAbsentRequired: jest.fn().mockResolvedValue(true),
    setRequiredOrThrow: jest.fn().mockResolvedValue(undefined),
    compareAndDeleteRequired: jest.fn().mockResolvedValue(true),
  };
  const llmProvider = {
    runWithRequestBudget: jest.fn(async (callback: () => Promise<unknown>) =>
      callback(),
    ),
    getModel: jest.fn().mockReturnValue({
      withStructuredOutput: jest.fn().mockReturnValue({ invoke }),
    }),
  };
  const config = {
    get: jest.fn((key: string, fallback: unknown) =>
      key === 'mem0.consolidation.enabled' ? enabled : fallback,
    ),
  };
  const userRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(builder),
  };
  const service = new MemoryConsolidationService(
    config as never,
    mem0Provider as never,
    llmProvider as never,
    redis as never,
    userRepository as never,
  );
  return {
    service,
    sources,
    proposal,
    builder,
    add,
    invoke,
    mem0Provider,
    redis,
    llmProvider,
    userRepository,
  };
};

describe('MemoryConsolidationService', () => {
  it('keeps the weekly job disabled by default', async () => {
    const { service, redis } = createFixture(false);

    await service.runScheduledConsolidation();

    expect(redis.setIfAbsentRequired).not.toHaveBeenCalled();
  });

  it('creates an exact, pending proposal without modifying source memories', async () => {
    const { service, add, invoke, redis, sources, mem0Provider } =
      createFixture();
    mem0Provider.getAll.mockResolvedValue(sources);

    await service.runScheduledConsolidation();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'Generated stable facts' }],
      userId: 'user-1',
      infer: false,
      metadata: expect.objectContaining({
        rag_memory_scope: 'user',
        rag_memory_kind: 'consolidation',
        rag_consolidation_status: 'pending_review',
        rag_consolidation_sources: expect.arrayContaining([
          expect.objectContaining({ id: 'source-1' }),
        ]),
      }),
    });
    expect(
      add.mock.calls[0][0].metadata.rag_consolidation_sources,
    ).toHaveLength(20);
    expect(mem0Provider.updateMetadata).not.toHaveBeenCalled();
    expect(redis.setRequiredOrThrow).toHaveBeenCalledWith(
      'rag:memory:consolidation:cursor',
      'user-1',
    );
  });

  it('lists a pending proposal with its source text and fingerprint state', async () => {
    const { service, mem0Provider, sources, proposal } = createFixture();
    mem0Provider.getAll.mockResolvedValue([...sources, proposal]);

    const pending = await service.listPending('user-1');

    expect(pending).toHaveLength(1);
    expect(pending[0]).toEqual(
      expect.objectContaining({
        id: 'proposal-1',
        summary: 'Reviewed summary',
        status: 'pending_review',
        sources: expect.arrayContaining([
          expect.objectContaining({
            id: 'source-1',
            memory: 'Long-term user fact 1',
            current: true,
          }),
        ]),
      }),
    );
    expect(pending[0]?.sources).toHaveLength(20);
  });

  it('approves a pending proposal only while all source fingerprints are current', async () => {
    const { service, mem0Provider, redis, sources, proposal } = createFixture();
    mem0Provider.getAll.mockResolvedValue([...sources, proposal]);

    await expect(service.approve('user-1', 'proposal-1')).resolves.toEqual({
      id: 'proposal-1',
      status: 'approved',
    });
    expect(mem0Provider.updateMetadata).toHaveBeenCalledWith(
      'proposal-1',
      expect.objectContaining({
        rag_consolidation_status: 'approved',
        rag_consolidation_reviewed_at: expect.any(String),
      }),
    );
    expect(redis.compareAndDeleteRequired).toHaveBeenCalledTimes(1);
  });

  it('marks a proposal stale instead of approving changed sources', async () => {
    const { service, mem0Provider, sources, proposal } = createFixture();
    sources[0].memory = 'Changed after proposal generation';
    mem0Provider.getAll.mockResolvedValue([...sources, proposal]);

    await expect(
      service.approve('user-1', 'proposal-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mem0Provider.updateMetadata).toHaveBeenCalledWith(
      'proposal-1',
      expect.objectContaining({
        rag_consolidation_status: 'stale',
        rag_consolidation_stale_at: expect.any(String),
      }),
    );
  });

  it('rejects a proposal by changing metadata and leaves originals intact', async () => {
    const { service, mem0Provider, sources, proposal } = createFixture();
    mem0Provider.getAll.mockResolvedValue([...sources, proposal]);

    await expect(service.reject('user-1', 'proposal-1')).resolves.toEqual({
      id: 'proposal-1',
      status: 'rejected',
    });
    expect(mem0Provider.updateMetadata).toHaveBeenCalledWith(
      'proposal-1',
      expect.objectContaining({
        rag_consolidation_status: 'rejected',
        rag_consolidation_reviewed_at: expect.any(String),
      }),
    );
    expect(mem0Provider.add).not.toHaveBeenCalled();
  });

  it('revokes an approved proposal so source memories can be restored', async () => {
    const { service, mem0Provider, sources, proposal } = createFixture();
    const approvedProposal: Mem0MemoryResult = {
      ...proposal,
      metadata: {
        ...proposal.metadata,
        rag_consolidation_status: 'approved',
      },
    };
    mem0Provider.getAll.mockResolvedValue([...sources, approvedProposal]);

    await expect(service.revoke('user-1', 'proposal-1')).resolves.toEqual({
      id: 'proposal-1',
      status: 'revoked',
    });
    expect(mem0Provider.updateMetadata).toHaveBeenCalledWith(
      'proposal-1',
      expect.objectContaining({ rag_consolidation_status: 'revoked' }),
    );
  });

  it('invalidates pending and approved proposals that use superseded sources', async () => {
    const { service, mem0Provider, sources, proposal } = createFixture();
    const approvedProposal: Mem0MemoryResult = {
      ...proposal,
      id: 'proposal-approved',
      metadata: {
        ...proposal.metadata,
        rag_consolidation_status: 'approved',
      },
    };
    mem0Provider.getAll.mockResolvedValue([
      ...sources,
      proposal,
      approvedProposal,
    ]);

    await service.invalidateForSupersededSources('user-1', ['source-1']);

    expect(mem0Provider.updateMetadata).toHaveBeenCalledTimes(2);
    expect(mem0Provider.updateMetadata).toHaveBeenNthCalledWith(
      1,
      'proposal-1',
      expect.objectContaining({ rag_consolidation_status: 'stale' }),
    );
    expect(mem0Provider.updateMetadata).toHaveBeenNthCalledWith(
      2,
      'proposal-approved',
      expect.objectContaining({ rag_consolidation_status: 'stale' }),
    );
  });
});
