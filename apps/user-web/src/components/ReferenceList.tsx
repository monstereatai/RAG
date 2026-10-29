import { useState } from 'react';
import type { ReferenceChunk } from '../types';

function ReferenceList({ references }: { references: ReferenceChunk[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="references">
      <div className="references-title">引用来源 ({references.length})</div>
      <div className="references-list">
        {references.map((ref, idx) => (
          <div key={ref.id} className="reference-item">
            <button
              className="reference-header"
              onClick={() => setExpanded(expanded === idx ? null : idx)}
            >
              <span className="reference-index">[{idx + 1}]</span>
              <span className="reference-score">
                总分: {ref.totalScore.toFixed(3)}
                {ref.bm25Score > 0 && ` | BM25: ${ref.bm25Score.toFixed(3)}`}
                {ref.cosineScore > 0 && ` | 余弦: ${ref.cosineScore.toFixed(3)}`}
              </span>
              <span className="reference-toggle">
                {expanded === idx ? '▼' : '▶'}
              </span>
            </button>
            {expanded === idx && (
              <div className="reference-content">
                <div className="reference-meta">
                  docId: {ref.docId} | chunk: {ref.chunkIndex}
                </div>
                <pre className="reference-text">{ref.content}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ReferenceList;
