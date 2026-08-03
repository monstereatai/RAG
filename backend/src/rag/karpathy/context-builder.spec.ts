import { ContextBuilder, detectRetrievalProfile } from './context-builder';
import type { RetrievedChunk } from './karpathy-rag.service';

function chunk(
  id: string,
  docId: string,
  content: string,
  totalScore: number,
): RetrievedChunk {
  return {
    id,
    docId,
    content,
    chunkIndex: Number(id.replace(/\D/g, '')) || 0,
    bm25Score: totalScore,
    cosineScore: totalScore,
    totalScore,
  };
}

describe('ContextBuilder', () => {
  it('selects adaptive retrieval profiles by query intent', () => {
    expect(detectRetrievalProfile('错误码 40003 是什么').intent).toBe('lookup');
    expect(detectRetrievalProfile('活动上线怎么验收').intent).toBe('procedure');
    expect(detectRetrievalProfile('对比台湾服和东南亚服差异').intent).toBe(
      'comparison',
    );
    expect(detectRetrievalProfile('生成完整前后端技术方案').intent).toBe(
      'generation',
    );
  });

  it('deduplicates chunks and enforces document diversity', () => {
    const profile = {
      ...detectRetrievalProfile('生成测试矩阵'),
      maxChunksPerDocument: 1,
      finalTopK: 3,
    };
    const result = new ContextBuilder().build(
      [
        chunk('c1', 'd1', '章节路径：规则\n同一条活动规则', 1),
        chunk('c2', 'd1', '内容类型：接口契约\n同一条活动规则', 0.9),
        chunk('c3', 'd1', '第二条规则', 0.8),
        chunk('c4', 'd2', '其他文档证据', 0.7),
      ],
      profile,
    );

    expect(result.chunks.map((item) => item.id)).toEqual(['c1', 'c4']);
    expect(result.stats.duplicateChunksRemoved).toBe(1);
    expect(result.stats.documentLimitRemoved).toBe(1);
  });

  it('keeps stable citations while arranging strong evidence at both ends', () => {
    const profile = {
      ...detectRetrievalProfile('生成完整方案'),
      finalTopK: 4,
    };
    const result = new ContextBuilder().build(
      [
        chunk('c1', 'd1', '证据一', 1),
        chunk('c2', 'd2', '证据二', 0.9),
        chunk('c3', 'd3', '证据三', 0.8),
        chunk('c4', 'd4', '证据四', 0.7),
      ],
      profile,
    );

    expect(result.chunks.map((item) => item.id)).toEqual([
      'c1',
      'c3',
      'c4',
      'c2',
    ]);
    expect(result.context).toContain('[片段 1｜hit]');
    expect(result.context).toContain('[片段 4｜hit]');
  });
});
