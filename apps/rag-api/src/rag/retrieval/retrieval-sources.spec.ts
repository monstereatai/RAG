import { ConfigService } from '@nestjs/config';
import {
  RetrievalSources,
  type SourceRecallRequest,
} from './retrieval-sources';
import { RetrievalPostprocessor } from './retrieval-postprocessor';

function fixture(mode = 'fallback') {
  const config = new ConfigService({ RAG_ES_KNN_MODE: mode });
  const embedding = { embedQuery: jest.fn().mockResolvedValue([0.1]) };
  const vector = {
    similaritySearch: jest.fn().mockResolvedValue([]),
    getRuntimeStatus: jest.fn().mockReturnValue({ available: true }),
  };
  const es = {
    isEnabled: jest.fn().mockReturnValue(true),
    search: jest.fn().mockResolvedValue([]),
    knnSearch: jest.fn().mockResolvedValue([]),
  };
  const metrics = {
    observeRetrievalStage: jest.fn(),
    observeRetrievalHits: jest.fn(),
    observeRetrievalRecalled: jest.fn(),
  };
  const source = {
    id: 'a',
    docId: 'doc-a',
    chunkIndex: 0,
    content: 'source',
    userId: 'user',
  };
  const request: SourceRecallRequest = {
    normalizedQuery: 'query',
    candidateDepth: 8,
    vectorSearch: true,
    userId: 'user',
    tenantId: 'tenant',
    allowedDocIds: new Set(['doc-a']),
    localBm25Hits: [{ ...source, score: 1 }],
    chunkMeta: new Map([['a', source]]),
    resolveDescriptionHits: jest.fn().mockReturnValue([]),
  };
  const descriptions = { searchByVector: jest.fn().mockResolvedValue([]) };
  const alerts = { notifyAlert: jest.fn().mockResolvedValue(undefined) };
  const service = new RetrievalSources(
    config,
    embedding,
    vector,
    es,
    metrics,
    new RetrievalPostprocessor(config),
    descriptions,
    alerts,
  );
  return {
    service,
    request,
    embedding,
    vector,
    es,
    metrics,
    descriptions,
    alerts,
  };
}

describe('RetrievalSources degradation compatibility', () => {
  it('keeps keyword hits when embedding fails and does not call ES without a query vector', async () => {
    const f = fixture();
    f.embedding.embedQuery.mockRejectedValue(new Error('embedding timeout'));
    const result = await f.service.recall(f.request);
    expect(result.bm25Hits).toEqual(f.request.localBm25Hits);
    expect(result.cosineHits).toEqual([]);
    expect(result.vectorSource).toBe('none');
    expect(f.es.knnSearch).not.toHaveBeenCalled();
    expect(f.alerts.notifyAlert).toHaveBeenCalledTimes(1);
    expect(f.metrics.observeRetrievalStage).toHaveBeenCalledWith(
      'vector_search',
      'error',
      expect.any(Number),
    );
  });

  it('uses ES when the primary vector channel is unavailable and still checks authorized source metadata', async () => {
    const f = fixture();
    f.vector.getRuntimeStatus.mockReturnValue({ available: false });
    f.es.knnSearch.mockResolvedValue([
      { id: 'a', score: 0.9 },
      { id: 'unknown', score: 1 },
    ]);
    const result = await f.service.recall(f.request);
    expect(f.vector.similaritySearch).not.toHaveBeenCalled();
    expect(result.cosineHits.map((h) => h.id)).toEqual(['a']);
    expect(result.vectorSource).toBe('elasticsearch');
    expect(f.es.knnSearch).toHaveBeenCalledWith([0.1], 8, 'user', {
      includeDeprecated: undefined,
      allowedDocIds: f.request.allowedDocIds,
    });
  });

  it('retains primary evidence when the supplemental description index fails', async () => {
    const f = fixture('always');
    f.vector.similaritySearch.mockResolvedValue([
      { id: 'a', docId: 'doc-a', chunkIndex: 0, content: 'short', score: 0.8 },
    ]);
    f.es.knnSearch.mockResolvedValue([{ id: 'a', score: 0.9 }]);
    f.descriptions.searchByVector.mockRejectedValue(
      new Error('description index down'),
    );
    const result = await f.service.recall(f.request);
    expect(result.cosineHits).toHaveLength(1);
    expect(result.cosineHits[0]).toMatchObject({
      id: 'a',
      content: 'source',
      score: 0.8,
    });
    expect(result.descriptionUsed).toBe(false);
    expect(result.vectorSource).toBe('milvus');
  });

  it('preserves keyword errors instead of silently changing the existing failure contract', async () => {
    const f = fixture();
    f.es.search.mockRejectedValue(new Error('keyword failure'));
    await expect(f.service.recall(f.request)).rejects.toThrow(
      'keyword failure',
    );
    expect(f.embedding.embedQuery).not.toHaveBeenCalled();
    expect(f.metrics.observeRetrievalStage).toHaveBeenCalledWith(
      'bm25',
      'error',
      expect.any(Number),
    );
  });
});
