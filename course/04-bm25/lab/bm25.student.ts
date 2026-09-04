/**
 * Lab 04 · 自研 BM25 —— 学员填空版
 *
 * 与生产 backend/src/rag/karpathy/bm25.util.ts（128 行）同构，3 处核心逻辑挖空。
 * 讲义：../README.md（重点 §3.1 打分公式 / §3.2 分词 / §3.3 tf 恒为 1）
 *
 * 修复依赖链：TODO① → 测试 1 绿；①+② → 测试 2 绿；①+②+③ → 测试 3 绿。
 */

import { Jieba } from '@node-rs/jieba';

export interface BM25Doc {
  id: string;
  content: string;
}

export interface BM25Hit {
  id: string;
  content: string;
  score: number;
}

// --- jieba 懒加载（给定：单例 + 静默降级）---

let _jieba: Jieba | null = null;
const getJieba = (): Jieba | null => {
  if (_jieba === null) {
    try {
      _jieba = new Jieba();
    } catch {
      _jieba = null;
    }
  }
  return _jieba;
};

// --- BM25 ---

export class BM25 {
  private readonly k1 = 1.5;
  private readonly b = 0.75;
  private readonly docs: BM25Doc[] = [];
  private readonly docTokens: string[][] = [];
  private readonly docFreq = new Map<string, number>(); // 词 → 出现该词的文档数
  private avgDocLen = 0;

  /**
   * 分词：jieba 中文分词 + 英文单词保留。
   * jieba 加载失败时自动降级为纯 JS 分词。
   */
  private tokenize(text: string): string[] {
    const jieba = getJieba();

    if (jieba) {
      // jieba 分词结果已经是 token 数组
      // 例如 cut('React React hooks') → ['React', ' ', 'React', ' ', 'hooks']
      // ===== TODO-1（生产 L53-58）=====
      // 要实现四步流水线：trim → toLowerCase → 过滤空串 → 去重（保持首次出现顺序）。
      // 注意：去重不是可选优化，是语义的一部分——讲义 §3.3，它让 tf 恒为 1。
      // 提示：去重保序一行完成（扩展运算符 + new Set）。
      return jieba.cut(text); // ← 错误实现：原样返回，未加工
    }

    // 降级：纯 JS 分词（给定）
    return text
      .toLowerCase()
      .split(/[\s,。！？.!?,;；:：()（）[\]【】""''""''`]+/)
      .filter((t) => t.length > 0);
  }

  addDocs(docs: BM25Doc[]): void {
    for (const doc of docs) {
      const tokens = this.tokenize(doc.content);
      this.docs.push(doc);
      this.docTokens.push(tokens);
      // ===== TODO-2（生产 L73-77）=====
      // 要实现 docFreq 计数：词 → 出现该词的【文档数】（不是出现次数！）。
      // 提示：对每篇文档的 tokens 先取 Set，再逐词 +1——想想为什么这里要再 Set 一次
      //（tokenize 已去重，这层是"不默默依赖上游语义"的防御，讲义 §3.4 同款思想）。
    }
    // ===== TODO-2（生产 L78-80）=====
    // 要实现 avgDocLen：全体 docTokens 的平均长度；空索引时保持 0。
    // 提示：reduce 求总长，除以 docTokens.length——别忘了除零保护。
  }

  clear(): void {
    this.docs.length = 0;
    this.docTokens.length = 0;
    this.docFreq.clear();
    this.avgDocLen = 0;
  }

  search(query: string, k: number): BM25Hit[] {
    const queryTokens = this.tokenize(query);
    const scores: BM25Hit[] = [];

    for (let i = 0; i < this.docs.length; i++) {
      const docTokens = this.docTokens[i];
      const docLen = docTokens.length;
      let score = 0;

      const termFreq = new Map<string, number>();
      for (const t of docTokens) {
        termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
      }

      for (const qt of queryTokens) {
        // ===== TODO-3（生产 L104-114）=====
        // 要实现单查询词的打分并累加进 score，四步：
        //   ① tf = termFreq.get(qt) ?? 0；tf 为 0 直接 continue（词不在文档里，不得分）
        //   ② idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)——+1 保证恒非负（讲义 §3.1）
        //   ③ tfNorm = tf*(k1+1) / (tf + k1*(1 - b + b*(docLen/avgDocLen)))——avgDocLen 为 0 时用 1 防除零
        //   ④ score += idf * tfNorm
        score += 0; // ← 替换这行
      }

      if (score > 0) {
        scores.push({
          id: this.docs[i].id,
          content: this.docs[i].content,
          score,
        });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, k);
  }
}
