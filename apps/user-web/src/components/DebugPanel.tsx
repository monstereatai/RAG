import { useState } from 'react';
import { debugChunks } from '../api';
import type { DebugChunk } from '../types';

function DebugPanel() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    query: string;
    topK: number;
    chunks: DebugChunk[];
  } | null>(null);
  const [error, setError] = useState('');

  const handleDebug = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await debugChunks(query.trim());
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const getScoreBar = (score: number, color: string) => (
    <div className="score-bar-wrapper">
      <div
        className="score-bar"
        style={{
          width: `${Math.round(Math.min(score, 1) * 100)}%`,
          background: color,
        }}
      />
    </div>
  );

  return (
    <div className="debug-panel">
      <div className="debug-panel-header">
        <h2>🔬 Debug 面板</h2>
        <p className="debug-desc">输入查询词，查看 BM25 / Cosine / 融合分数排名</p>
      </div>

      <div className="debug-query-form">
        <input
          id="debug-query-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleDebug()}
          placeholder="输入查询词（如：LangChain、RAG管线）"
          disabled={loading}
        />
        <button
          id="debug-query-btn"
          onClick={handleDebug}
          disabled={!query.trim() || loading}
        >
          {loading ? '检索中...' : '检索分析'}
        </button>
      </div>

      {error && <div className="debug-error">❌ {error}</div>}

      {result && (
        <div className="debug-result">
          <div className="debug-result-meta">
            查询：<strong>"{result.query}"</strong> · TopK={result.topK} · 共 {result.chunks.length} 个结果
          </div>

          {result.chunks.length === 0 ? (
            <div className="debug-empty">无检索结果，请先上传文档</div>
          ) : (
            <div className="debug-chunks">
              {result.chunks.map((chunk, idx) => (
                <div key={chunk.id} className="debug-chunk-card">
                  <div className="debug-chunk-header">
                    <span className="debug-chunk-rank">#{idx + 1}</span>
                    <span className="debug-chunk-doc">
                      DocID: <code>{chunk.docId.slice(0, 8)}...</code>
                      &nbsp;·&nbsp;Chunk #{chunk.chunkIndex}
                    </span>
                    <span className="debug-chunk-total-score">
                      融合分: <strong>{chunk.totalScore.toFixed(4)}</strong>
                    </span>
                  </div>

                  <div className="debug-score-rows">
                    <div className="debug-score-row">
                      <span className="score-label bm25-label">BM25</span>
                      {getScoreBar(chunk.bm25Score, '#fa8c16')}
                      <span className="score-value">{chunk.bm25Score.toFixed(4)}</span>
                    </div>
                    <div className="debug-score-row">
                      <span className="score-label cosine-label">Cosine</span>
                      {getScoreBar(chunk.cosineScore, '#1890ff')}
                      <span className="score-value">{chunk.cosineScore.toFixed(4)}</span>
                    </div>
                    <div className="debug-score-row">
                      <span className="score-label fused-label">融合</span>
                      {getScoreBar(chunk.totalScore, '#52c41a')}
                      <span className="score-value">{chunk.totalScore.toFixed(4)}</span>
                    </div>
                  </div>

                  <details className="debug-chunk-content">
                    <summary>查看 Chunk 原文</summary>
                    <pre className="debug-chunk-text">{chunk.content}</pre>
                  </details>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DebugPanel;
