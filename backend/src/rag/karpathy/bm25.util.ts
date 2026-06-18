/**
 * 纯 JS BM25 实现（Karpathy-Style RAG 的关键词检索部分）
 * M1 阶段：简单空格 + 标点分词 + 中文字符/bigram 兜底（M2 再换 jieba）
 */

export interface BM25Doc {
  id: string;
  content: string;
}

export interface BM25Hit {
  id: string;
  content: string;
  score: number;
}

export class BM25 {
  private readonly k1 = 1.5;
  private readonly b = 0.75;
  private readonly docs: BM25Doc[] = [];
  private readonly docTokens: string[][] = [];
  private readonly docFreq = new Map<string, number>(); // 词 → 出现该词的文档数
  private avgDocLen = 0;

  /**
   * 简单分词：按空格 + 中英标点切分，转小写。
   * 中文片段额外加入单字和 bigram，避免未接入 jieba 前中文查询完全空召回。
   */
  private tokenize(text: string): string[] {
    const rawTokens = text
      .toLowerCase()
      .split(/[\s,。！？.!?,;；:：()（）[\]【】""''""''`]+/)
      .filter((t) => t.length > 0);

    const tokens: string[] = [];
    for (const token of rawTokens) {
      tokens.push(token);

      const cjkChars = Array.from(token).filter((char) =>
        /[\u4e00-\u9fff]/.test(char),
      );
      if (cjkChars.length === 0) continue;

      tokens.push(...cjkChars);
      for (let i = 0; i < cjkChars.length - 1; i += 1) {
        tokens.push(`${cjkChars[i]}${cjkChars[i + 1]}`);
      }
    }

    return tokens;
  }

  addDocs(docs: BM25Doc[]): void {
    for (const doc of docs) {
      const tokens = this.tokenize(doc.content);
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
