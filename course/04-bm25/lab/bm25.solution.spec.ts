/**
 * Lab 04 · 参考答案自检
 *
 * 与学员版验收测试（bm25.student.spec.ts）逐字一致，仅 import 指向参考答案——
 * bm25.solution.ts 与生产 bm25.util.ts 逐字节一致，此文件通过即证明生产实现同样通过。
 */
import { BM25 } from './bm25.solution';

describe('Lab 04 · 自研 BM25（参考答案自检）', () => {
  it('测试 1（TODO-1）：tokenize 加工流水线', () => {
    const bm25 = new BM25();

    expect((bm25 as any).tokenize('React React hooks')).toEqual(['react', 'hooks']);
    expect((bm25 as any).tokenize('智能体 智能体 应用')).toEqual(['智', '能', '体', '应', '用']);
    expect((bm25 as any).tokenize('   ')).toEqual([]);
  });

  it('测试 2（TODO-2）：docFreq 与 avgDocLen', () => {
    const bm25 = new BM25();
    bm25.addDocs([
      { id: 'd1', content: 'vector search' },
      { id: 'd2', content: 'vector vector vector' },
      { id: 'd3', content: 'search generation' },
    ]);

    expect((bm25 as any).docFreq.get('vector')).toBe(2);
    expect((bm25 as any).docFreq.get('search')).toBe(2);
    expect((bm25 as any).docFreq.get('generation')).toBe(1);
    expect((bm25 as any).avgDocLen).toBeCloseTo(5 / 3, 5);
  });

  it('测试 3（TODO-3）：打分公式手算对拍', () => {
    const bm25 = new BM25();
    bm25.addDocs([
      { id: 'd1', content: 'alpha' },
      { id: 'd2', content: 'alpha alpha alpha' },
      { id: 'd3', content: 'alpha beta gamma delta epsilon' },
      { id: 'd4', content: 'beta gamma' },
    ]);

    const hits = bm25.search('alpha', 4);

    expect(hits).toHaveLength(3);

    const s1 = hits.find((h) => h.id === 'd1')!.score;
    const s2 = hits.find((h) => h.id === 'd2')!.score;
    const s3 = hits.find((h) => h.id === 'd3')!.score;

    expect(s1).toBeCloseTo(0.4755666, 4);
    expect(s2).toBeCloseTo(0.4755666, 4);
    expect(s3).toBeCloseTo(0.2301116, 4);

    expect(s2).toBe(s1);

    expect(hits[2].id).toBe('d3');

    expect(bm25.search('alpha', 2)).toHaveLength(2);
  });
});
