import { ConfigService } from '@nestjs/config';
import type { RetrievedChunk } from '../evidence/retrieval.types';
import { retrievalProfileForTaskType } from './context-builder';
import {
  RetrievalPostprocessor,
  type IndexedChunk,
} from './retrieval-postprocessor';

const chunk = (
  id: string,
  extra: Partial<RetrievedChunk> = {},
): RetrievedChunk => ({
  id,
  docId: `doc-${id}`,
  chunkIndex: 0,
  content: `source ${id}`,
  bm25Score: 0,
  cosineScore: 0,
  totalScore: 0.7,
  ...extra,
});

describe('RetrievalPostprocessor compatibility', () => {
  const processor = new RetrievalPostprocessor(new ConfigService());

  it('does not reintroduce invisible versions through neighbor or section expansion', () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-29T00:00:00Z'));
    try {
      const primary = chunk('primary', {
        docId: 'doc',
        chunkIndex: 1,
        sectionId: 'section',
      });
      const entries = [
        { ...chunk('draft'), lifecycleStatus: 'draft' },
        { ...chunk('archived'), lifecycleStatus: 'archived' },
        { ...chunk('future'), effectiveAt: '2026-10-30T00:00:00Z' },
        { ...chunk('expired'), expiredAt: '2026-10-29T00:00:00Z' },
        { ...chunk('visible'), effectiveAt: '2026-10-29T00:00:00Z' },
      ].map((entry) => ({
        ...entry,
        docId: 'doc',
        sectionId: 'section',
        chunkIndex: 2,
        userId: 'user',
      }));
      const result = processor.expandContextChunks(
        entries,
        [primary],
        {
          ...retrievalProfileForTaskType('procedure'),
          sameSectionLimit: 10,
        },
        'user',
        {},
        new Set(['doc']),
      );
      expect(result.map((entry) => entry.id)).toEqual(['primary', 'visible']);
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('fuses channel ranks and restores authoritative metadata without confusing raw scores', () => {
    const source = chunk('a', { content: 'complete source', docVersion: 'v2' });
    const metadata = new Map([['a', source]]);
    const result = processor.fuseByRrf(
      metadata,
      [
        { ...chunk('b'), score: 20 },
        { ...source, score: 10 },
      ],
      [{ ...chunk('a'), content: 'truncated', score: 0.9 }],
    );
    expect(result.map(({ id }) => id)).toEqual(['b', 'a']);
    expect(result[0].totalScore).toBe(0.3);
    expect(result[1].totalScore).toBeCloseTo(0.7 + (0.3 * 61) / 62);
    expect(result[1]).toMatchObject({
      content: 'complete source',
      docVersion: 'v2',
      bm25Score: 0.5,
      cosineScore: 0.9,
    });
    expect(result[1].rerankScore).toBeUndefined();
  });

  it('drops unknown, unauthorized, draft and expired vector hits using trusted source metadata', () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-29T00:00:00Z'));
    try {
      const metadata = new Map<string, IndexedChunk>([
        [
          'a',
          {
            ...chunk('a'),
            userId: 'owner',
            effectiveAt: '2026-10-29T00:00:00Z',
          },
        ],
        ['b', { ...chunk('b'), userId: 'other' }],
        ['c', { ...chunk('c'), userId: 'owner', lifecycleStatus: 'draft' }],
        [
          'd',
          { ...chunk('d'), userId: 'owner', expiredAt: '2026-10-29T00:00:00Z' },
        ],
      ]);
      const hits = ['a', 'b', 'c', 'd', 'unknown'].map((id) => ({
        ...chunk(id),
        score: 1,
      }));
      expect(
        processor
          .filterActiveVectorHits(metadata, hits, 'owner')
          .map((h) => h.id),
      ).toEqual(['a']);
      expect(
        processor
          .filterActiveVectorHits(metadata, hits, 'owner', new Set(['doc-b']))
          .map((h) => h.id),
      ).toEqual(['b']);
      expect(
        processor.filterActiveVectorHits(metadata, hits, 'owner', new Set()),
      ).toEqual([]);
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('preserves fusion scores when rerank changes order and fails open on provider errors', async () => {
    const input = [
      chunk('a', { totalScore: 0.9 }),
      chunk('b', { totalScore: 0.5 }),
    ];
    const rerank = jest
      .fn()
      .mockResolvedValue([
        chunk('b', { totalScore: 0.99 }),
        chunk('a', { totalScore: 0.01 }),
      ]);
    const service = new RetrievalPostprocessor(new ConfigService(), {
      isEnabled: () => true,
      rerank,
    });
    const signal = new AbortController().signal;
    const result = await service.applyRerank('query', input, signal);
    expect(result.applied).toBe(true);
    expect(
      result.chunks.map((c) => [c.id, c.totalScore, c.rerankScore]),
    ).toEqual([
      ['b', 0.5, 0.99],
      ['a', 0.9, 0.01],
    ]);
    expect(rerank).toHaveBeenCalledWith('query', input, 20, signal);
    rerank.mockRejectedValueOnce(new Error('provider unavailable'));
    expect(await service.applyRerank('query', input)).toEqual({
      chunks: input,
      applied: false,
    });
    expect(input[0].rerankScore).toBeUndefined();
  });

  it('keeps source scope and authorized document boundaries during expansion', () => {
    const primary = chunk('a', {
      projectId: 'project',
      docId: 'shared',
      chunkIndex: 1,
    });
    const entries = [
      {
        ...chunk('b'),
        projectId: 'project',
        docId: 'shared',
        chunkIndex: 2,
        userId: 'other',
      },
      {
        ...chunk('c'),
        projectId: 'elsewhere',
        docId: 'shared',
        chunkIndex: 0,
        userId: 'other',
      },
      {
        ...chunk('d'),
        projectId: 'project',
        docId: 'private',
        chunkIndex: 2,
        userId: 'other',
      },
    ];
    const result = processor.expandContextChunks(
      entries,
      [primary],
      retrievalProfileForTaskType('procedure'),
      'user',
      { projectId: 'PROJECT' },
      new Set(['shared']),
    );
    expect(result.map((c) => c.id)).toEqual(['a', 'b']);
    expect(result[1]).toMatchObject({
      contextRole: 'neighbor',
      totalScore: primary.totalScore * 0.85,
    });
    expect(processor.matchesScope({ lifecycleStatus: 'deprecated' }, {})).toBe(
      false,
    );
    expect(
      processor.matchesScope(
        { lifecycleStatus: 'deprecated' },
        { includeDeprecated: true },
      ),
    ).toBe(true);
  });
});

describe('RetrievalPostprocessor historical effective-time filtering', () => {
  it('keeps authorized overlapping versions and still excludes draft, archived and out-of-window versions', () => {
    const processor = new RetrievalPostprocessor(new ConfigService());
    const metadata = new Map<string, IndexedChunk>([
      [
        'overlap',
        {
          ...chunk('overlap'),
          userId: 'owner',
          effectiveAt: '2025-09-15T00:00:00.000Z',
          expiredAt: '2025-10-15T00:00:00.000Z',
          lifecycleStatus: 'expired',
        },
      ],
      [
        'deprecated-without-dates',
        {
          ...chunk('deprecated-without-dates'),
          userId: 'owner',
          lifecycleStatus: 'deprecated',
        },
      ],
      [
        'before-window',
        {
          ...chunk('before-window'),
          userId: 'owner',
          expiredAt: '2025-09-01T00:00:00.000Z',
        },
      ],
      [
        'after-window',
        {
          ...chunk('after-window'),
          userId: 'owner',
          effectiveAt: '2025-11-01T00:00:00.000Z',
        },
      ],
      [
        'draft',
        {
          ...chunk('draft'),
          userId: 'owner',
          effectiveAt: '2025-09-15T00:00:00.000Z',
          lifecycleStatus: 'draft',
        },
      ],
      [
        'archived',
        {
          ...chunk('archived'),
          userId: 'owner',
          effectiveAt: '2025-09-15T00:00:00.000Z',
          lifecycleStatus: 'archived',
        },
      ],
      [
        'other-owner',
        {
          ...chunk('other-owner'),
          userId: 'other',
          effectiveAt: '2025-09-15T00:00:00.000Z',
        },
      ],
    ]);
    const hits = [...metadata.keys()].map((id) => ({
      ...chunk(id),
      score: 1,
    }));

    const result = processor.filterActiveVectorHits(
      metadata,
      hits,
      'owner',
      undefined,
      {
        effectiveTime: {
          from: '2025-09-01T00:00:00.000Z',
          to: '2025-11-01T00:00:00.000Z',
        },
        includeDeprecated: true,
      },
    );

    expect(result.map((hit) => hit.id)).toEqual([
      'overlap',
      'deprecated-without-dates',
    ]);
  });
});
