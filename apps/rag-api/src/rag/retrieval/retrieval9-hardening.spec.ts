import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { DocumentChunkEntity } from '../../providers/db/entities/document-chunk.entity';
import { ElasticsearchProvider } from '../../providers/elasticsearch/elasticsearch.provider';
import { AuthoritativeChunkService } from './authoritative-chunk.service';
import { ContextBuilder, retrievalProfileForTaskType } from './context-builder';
import { RetrievalPostprocessor } from './retrieval-postprocessor';
import type { RetrievedChunk } from '../evidence/retrieval.types';

const codeMetadata = (filePath: string) => JSON.stringify({
  kind: 'code', filePath, language: 'typescript', symbol: 'run',
  startLine: 10, endLine: 30,
});

function codeChunk(id: string, filePath: string, chunkIndex: number): RetrievedChunk {
  return {
    id,
    docId: 'repo-zip',
    content: `File: ${filePath}\nSymbol: run\nfunction run() { return 1; }`,
    chunkIndex,
    bm25Score: 1,
    cosineScore: 1,
    totalScore: 1,
    documentType: 'code',
    sourceMetadata: codeMetadata(filePath),
  };
}

describe('Retrieval 9 hardening regression', () => {
  it('resolves description source chunks from PostgreSQL under tenant + document ACL', async () => {
    const rows: Partial<DocumentChunkEntity>[] = [
      { id: 'safe', docId: 'allowed', tenantId: 't1', userId: 'u', chunkType: 'leaf',
        content: 'approved', chunkIndex: 0, indexGeneration: 'g2', docVersion: 'v2' },
      { id: 'other', docId: 'blocked', tenantId: 't1', userId: 'v', chunkType: 'leaf',
        content: 'private', chunkIndex: 0 },
      { id: 'cross', docId: 'allowed', tenantId: 't2', userId: 'v', chunkType: 'leaf',
        content: 'other-tenant', chunkIndex: 0 },
    ];
    const repo = { find: jest.fn().mockResolvedValue(rows) } as unknown as Repository<DocumentChunkEntity>;
    const service = new AuthoritativeChunkService(repo);
    const result = await service.loadDescriptionSourceEntries(['safe', 'other', 'cross'], {
      tenantId: 't1', userId: 'u', allowedDocIds: new Set(['allowed']),
    });
    expect(result.map((item) => item.id)).toEqual(['safe']);
    expect(result[0]).toMatchObject({ indexGeneration: 'g2', docVersion: 'v2' });
  });

  it('checks graph/image evidence scope and historical dates without local BM25', async () => {
    const rows: Partial<DocumentChunkEntity>[] = [
      { docId: 'correct', tenantId: 't1', userId: 'u', lifecycleStatus: 'effective',
        projectId: 'p1', effectiveAt: new Date('2025-01-01T00:00:00Z'),
        expiredAt: new Date('2025-03-01T00:00:00Z') },
      { docId: 'expired', tenantId: 't1', userId: 'u', lifecycleStatus: 'effective',
        projectId: 'p1', expiredAt: new Date('2024-12-01T00:00:00Z') },
      { docId: 'other-project', tenantId: 't1', userId: 'u', lifecycleStatus: 'effective',
        projectId: 'p2' },
      { docId: 'other-tenant', tenantId: 't2', userId: 'v', lifecycleStatus: 'effective',
        projectId: 'p1' },
    ];
    const repo = { find: jest.fn().mockResolvedValue(rows) } as unknown as Repository<DocumentChunkEntity>;
    const service = new AuthoritativeChunkService(repo);
    const visible = await service.loadVisibleEvidenceDocIds(
      rows.map((row) => row.docId!),
      { tenantId: 't1', userId: 'u', allowedDocIds: new Set(rows.map((row) => row.docId!)) },
      { projectId: 'p1', effectiveTime: {
        from: '2025-02-01T00:00:00Z', to: '2025-03-01T00:00:00Z',
      } },
    );
    expect([...visible]).toEqual(['correct']);
  });

  it('never expands a code hit into a different source file in the same ZIP', () => {
    const source = [
      { ...codeChunk('a', 'src/a.ts', 1), userId: 'u' },
      { ...codeChunk('b', 'src/b.ts', 2), userId: 'u' },
      { ...codeChunk('c', 'src/a.ts', 3), userId: 'u' },
    ];
    const policy = new RetrievalPostprocessor(new ConfigService());
    const result = policy.expandContextChunks(
      source,
      [codeChunk('a', 'src/a.ts', 1)],
      { ...retrievalProfileForTaskType('procedure'), neighborWindow: 2, sameSectionLimit: 0 },
      'u', undefined, new Set(['repo-zip']),
    );
    expect(result.map((chunk) => chunk.id)).toEqual(['a', 'c']);
  });

  it('diversifies code chunks by file and cites symbol + exact lines', () => {
    const chunks = [
      codeChunk('a', 'src/a.ts', 1),
      codeChunk('b', 'src/b.ts', 2),
      codeChunk('c', 'src/a.ts', 3),
    ];
    const profile = {
      ...retrievalProfileForTaskType('lookup'),
      maxChunksPerDocument: 1,
      candidateDepth: 8,
      finalTopK: 4,
      contextCharacterBudget: 10_000,
    };
    const result = new ContextBuilder().build(chunks, profile);
    expect(result.chunks.map((chunk) => chunk.id)).toEqual(['a', 'b']);
    expect(result.chunks[0].citationLabel).toContain('src/a.ts / run / L10-L30');
  });

  it('uses consistent business-scope, ACL and role filters for ES BM25 and kNN', () => {
    const provider = new ElasticsearchProvider(new ConfigService());
    const internal = provider as unknown as {
      chunkFilters: (userId: string, scope: Record<string, string>, allowed: Set<string>) => unknown[];
    };
    const filters = internal.chunkFilters('u',
      { projectId: 'p1', documentType: 'code', role: 'developer' },
      new Set(['allowed-doc']));
    const json = JSON.stringify(filters);
    expect(json).toContain('allowed-doc');
    expect(json).toContain('projectId');
    expect(json).toContain('documentType');
    expect(json).toContain('roleScope');
    expect(json).toContain('draft');
    expect(json).toContain('archived');
  });
});
