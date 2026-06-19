import { BM25 } from './bm25.util';

describe('BM25', () => {
  it('ranks the most relevant English document first', () => {
    const bm25 = new BM25();
    bm25.addDocs([
      { id: 'react', content: 'React uses component state and hooks' },
      { id: 'redis', content: 'Redis stores cache entries in memory' },
      { id: 'rag', content: 'RAG retrieves documents before generation' },
    ]);

    const hits = bm25.search('react hooks state', 3);

    expect(hits[0].id).toBe('react');
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('can retrieve Chinese content with jieba tokenization', () => {
    const bm25 = new BM25();
    bm25.addDocs([
      { id: 'langchain', content: 'LangChain 用于构建 RAG 应用和智能体' },
      { id: 'docker', content: 'Docker Compose 用于启动基础设施' },
    ]);

    const hits = bm25.search('智能体应用', 2);

    expect(hits.map((hit) => hit.id)).toContain('langchain');
  });

  it('clears indexed documents', () => {
    const bm25 = new BM25();
    bm25.addDocs([{ id: 'doc', content: 'temporary searchable content' }]);

    expect(bm25.search('temporary', 1)).toHaveLength(1);

    bm25.clear();

    expect(bm25.search('temporary', 1)).toHaveLength(0);
  });
});
