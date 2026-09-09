/**
 * 纯 JS BM25 实现（Karpathy-Style RAG 的关键词检索部分）
 * 接入 @node-rs/jieba 中文分词，英文 token 保留完整
 */

import { Jieba } from '@node-rs/jieba';

export interface BM25Doc {
  id: string;
  content: string;
  searchText?: string;
}

export interface BM25Hit {
  id: string;
  content: string;
  score: number;
}

// --- jieba 懒加载 ---

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
      // 合并小写 + 去重，同时过滤空串
      const tokens = jieba
        .cut(text)
        .map((t: string) => t.trim().toLowerCase())
        .filter((t: string) => t.length > 0);
      // 去重保持顺序
      return [...new Set(tokens)];
    }

    // 降级：纯 JS 分词
    return text
      .toLowerCase()
      .split(/[\s,。！？.!?,;；:：()（）[\]【】""''""''`]+/)
      .filter((t) => t.length > 0);
  }

  addDocs(docs: BM25Doc[]): void {
    for (const doc of docs) {
      const tokens = this.tokenize(doc.searchText ?? doc.content);
      this.docs.push(doc);
      this.docTokens.push(tokens);
      const uniqueTokens = new Set(tokens);
      for (const t of uniqueTokens) {
        this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
      }
    }
    const totalLen = this.docTokens.reduce((sum, t) => sum + t.length, 0);
    this.avgDocLen =
      this.docTokens.length > 0 ? totalLen / this.docTokens.length : 0;
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
        const tf = termFreq.get(qt) ?? 0;
        if (tf === 0) continue;
        const df = this.docFreq.get(qt) ?? 0;
        const idf = Math.log((this.docs.length - df + 0.5) / (df + 0.5) + 1);
        const tfNorm =
          (tf * (this.k1 + 1)) /
          (tf +
            this.k1 * (1 - this.b + this.b * (docLen / (this.avgDocLen || 1))));
        score += idf * tfNorm;
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
