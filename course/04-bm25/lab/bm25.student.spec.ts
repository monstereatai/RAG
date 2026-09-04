/**
 * Lab 04 · 验收测试（学员版）
 *
 * 3 个用例与 3 处 TODO 对应（存在依赖链：①→测试1；①+②→测试2；①+②+③→测试3）。
 * 测试 3 是手算对拍——期望分数来自人工计算（见 lab/README.md"对拍数字的由来"），
 * 不是用与实现相同的公式算出来的（那叫同构，不叫对拍）。
 *
 * 说明：`(bm25 as any).tokenize` 是运行时访问 private——TypeScript 的 private 只是
 * 编译期约束，单测里这是检查内部状态的常用手法（生产 spec 不这么做，教学 spec 可以）。
 */
import { BM25 } from './bm25.student';

describe('Lab 04 · 自研 BM25（学员版）', () => {
  it('测试 1（TODO-1）：tokenize 加工流水线', () => {
    const bm25 = new BM25();

    // (a) 英文：小写 + 去重保序（jieba 对英文整词保留，空格 token 被 trim 过滤）
    expect((bm25 as any).tokenize('React React hooks')).toEqual(['react', 'hooks']);

    // (b) 中文：jieba 默认模式逐字切分 + 去重（讲义 §3.2 的实际行为）
    expect((bm25 as any).tokenize('智能体 智能体 应用')).toEqual(['智', '能', '体', '应', '用']);

    // (c) 空串与纯空白：过滤后为空数组
    expect((bm25 as any).tokenize('   ')).toEqual([]);
  });

  it('测试 2（TODO-2）：docFreq 与 avgDocLen', () => {
    const bm25 = new BM25();
    bm25.addDocs([
      { id: 'd1', content: 'vector search' },          // tokens: ['vector','search']（len 2）
      { id: 'd2', content: 'vector vector vector' },   // tokens: ['vector']（去重后 len 1）
      { id: 'd3', content: 'search generation' },      // tokens: ['search','generation']（len 2）
    ]);

    // (a) df 是"出现该词的文档数"，不是出现次数：vector 出现在 2 篇文档（d2 里 3 次只算 1 篇）
    expect((bm25 as any).docFreq.get('vector')).toBe(2);
    expect((bm25 as any).docFreq.get('search')).toBe(2);
    expect((bm25 as any).docFreq.get('generation')).toBe(1);

    // (b) avgDocLen = (2 + 1 + 2) / 3 = 5/3
    expect((bm25 as any).avgDocLen).toBeCloseTo(5 / 3, 5);
  });

  it('测试 3（TODO-3）：打分公式手算对拍', () => {
    const bm25 = new BM25();
    bm25.addDocs([
      { id: 'd1', content: 'alpha' },                        // len 1
      { id: 'd2', content: 'alpha alpha alpha' },            // 去重后 len 1——tf 恒为 1 的证据
      { id: 'd3', content: 'alpha beta gamma delta epsilon' }, // len 5
      { id: 'd4', content: 'beta gamma' },                   // len 2，不含 alpha
    ]);

    // N=4，df(alpha)=3，avgDocLen=(1+1+5+2)/4=2.25
    // idf = ln((4-3+0.5)/(3+0.5) + 1) = ln(10/7) ≈ 0.3566749
    // d1/d2（len 1）：tfNorm = 2.5/(1+1.5*(0.25+0.75*(1/2.25))) = 2.5/1.875 → score ≈ 0.4755666
    // d3（len 5）：tfNorm = 2.5/3.875 → score ≈ 0.2301116
    const hits = bm25.search('alpha', 4);

    // (a) d4 不含查询词（score=0 被 score>0 门挡掉）→ 只有 3 条
    //     注意 df=3 > N/2=2：若 idf 漏了 +1，分数全负、这里会一条都拿不到
    expect(hits).toHaveLength(3);

    const s1 = hits.find((h) => h.id === 'd1')!.score;
    const s2 = hits.find((h) => h.id === 'd2')!.score;
    const s3 = hits.find((h) => h.id === 'd3')!.score;

    // (b) 手算对拍：精确分数
    expect(s1).toBeCloseTo(0.4755666, 4);
    expect(s2).toBeCloseTo(0.4755666, 4);
    expect(s3).toBeCloseTo(0.2301116, 4);

    // (c) tf 恒为 1（讲义 §3.3 灵魂）：'alpha' 出现 1 次与 3 次的文档得分完全相等
    //     若 tokenize 没去重，d2 的 tf=3、len=3，得分会显著高于 d1
    expect(s2).toBe(s1);

    // (d) 长度归一化生效：长文档（d3，len 5）排在最后
    expect(hits[2].id).toBe('d3');

    // (e) top-k 截断
    expect(bm25.search('alpha', 2)).toHaveLength(2);
  });
});
