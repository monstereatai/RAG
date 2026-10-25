import type { ConfigService } from '@nestjs/config';
import { retrievalProfileForTaskType } from './context-builder';
import type { RetrievedChunk } from './karpathy-rag.service';
import type { QueryTaskType } from '../planning/query-plan';

/** 检查召回证据是否够用，以及回答中的结论和引用是否能被证据支撑。 */
export class AnswerQualityService {
  constructor(private readonly configService: Pick<ConfigService, 'get'>) {}

  private normalizeQuery(query: string): string {
    return query.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  assessRetrievalQuality(
    query: string,
    chunks: RetrievedChunk[],
    taskType: QueryTaskType = 'lookup',
  ): { sufficient: boolean; reason: string } {
    const topScore = chunks[0]?.totalScore ?? 0;
    const profile = retrievalProfileForTaskType(taskType);
    const configuredMinTopScore =
      this.configService.get<number>('ragQuality.minTopScore') ?? 0.05;
    const intentFloor =
      profile.intent === 'lookup'
        ? 0.05
        : profile.intent === 'procedure'
          ? 0.045
          : profile.intent === 'comparison'
            ? 0.04
            : 0.035;
    const minTopScore = Math.max(
      0,
      Math.min(configuredMinTopScore, intentFloor),
    );
    if (topScore < minTopScore) {
      return {
        sufficient: false,
        reason: `最高检索分 ${topScore.toFixed(3)} 低于阈值 ${minTopScore}`,
      };
    }

    // Rerank 是针对“问题－片段”对的语义相关度判断。它存在且通过门槛时，
    // 不再要求用户的表达方式（例如“请总结”“资料库中”）逐字出现在资料原文，
    // 否则会把实际命中的内容错误降级为“资料不足”。未配置或未返回重排分时，
    // 仍使用下方的词面门禁作为保守兜底。
    const strongestRerankScore = Math.max(
      ...chunks.map((chunk) => chunk.rerankScore ?? Number.NEGATIVE_INFINITY),
    );
    const minRerankScore =
      this.configService.get<number>('ragQuality.minRerankScore') ?? 0.65;
    if (strongestRerankScore >= minRerankScore) {
      return {
        sufficient: true,
        reason: `重排语义相关度 ${strongestRerankScore.toFixed(3)} 通过阈值 ${minRerankScore}`,
      };
    }

    const queryTokens = this.extractQualityTokens(query);
    const minOverlap =
      this.configService.get<number>('ragQuality.minQueryTokenOverlap') ?? 1;
    if (queryTokens.size === 0 || minOverlap <= 0) {
      return { sufficient: true, reason: '检索分数通过阈值' };
    }

    const maxOverlap = Math.max(
      ...chunks.map((chunk) =>
        this.countTokenOverlap(queryTokens, chunk.content),
      ),
      0,
    );
    // 中文没有天然空格，单字／分词重合很容易把「问法」误当成「事实」。
    // 使用连续 CJK 二元组补充词面诊断，要求至少三个不同二元组，既不依赖
    // 业务关键词，也不会把只碰巧共享“住宿／报销”之类短语的弱命中放行。
    const cjkBigramOverlap = Math.max(
      ...chunks.map((chunk) =>
        this.countCjkBigramOverlap(query, chunk.content),
      ),
      0,
    );
    const hasStrongCjkOverlap = cjkBigramOverlap >= 3;
    const hasStrongWordOverlap = this.countWordOverlap(query, chunks) >= 2;
    if (
      maxOverlap < minOverlap &&
      !hasStrongCjkOverlap &&
      !hasStrongWordOverlap
    ) {
      return {
        sufficient: false,
        reason: `检索片段与问题关键词重合数 ${maxOverlap} 低于阈值 ${minOverlap}`,
      };
    }

    const queryChineseTerms = this.extractChinesePhraseTokens(query);
    if (queryChineseTerms.size >= 3) {
      const maxPhraseOverlap = Math.max(
        ...chunks.map((chunk) =>
          this.countChinesePhraseOverlap(queryChineseTerms, chunk.content),
        ),
        0,
      );
      const minPhraseOverlap =
        this.configService.get<number>('ragQuality.minChinesePhraseOverlap') ??
        2;
      if (
        maxPhraseOverlap < minPhraseOverlap &&
        !hasStrongCjkOverlap &&
        !hasStrongWordOverlap
      ) {
        return {
          sufficient: false,
          reason: `检索片段与问题中文短语重合数 ${maxPhraseOverlap} 低于阈值 ${minPhraseOverlap}`,
        };
      }
    }

    // 中文问题通常同时包含“报销／标准／系统”这类通用词和真正的业务锚点。
    // 仅命中通用词不能证明资料相关，例如“宠物报销”不能被差旅制度放行。
    // 至少要命中一个去掉问法、流程泛词后的连续中文锚点；英文缩写由
    // hasStrongWordOverlap 负责覆盖。
    const queryAnchorPhrases = this.extractChineseAnchorPhrases(query);
    if (queryAnchorPhrases.size > 0) {
      const maxAnchorOverlap = Math.max(
        ...chunks.map((chunk) =>
          this.countChinesePhraseOverlap(queryAnchorPhrases, chunk.content),
        ),
        0,
      );
      if (
        maxAnchorOverlap === 0 &&
        this.countWordOverlap(query, chunks) === 0
      ) {
        return {
          sufficient: false,
          reason: '检索片段未命中问题中的业务锚点',
        };
      }
    }

    return { sufficient: true, reason: '检索分数与关键词重合通过阈值' };
  }

  assessCitationSupport(
    answer: string,
    chunks: RetrievedChunk[],
  ): { sufficient: boolean; reason: string } {
    const citedIndexes = this.extractCitedIndexes(answer);
    if (citedIndexes.size === 0) {
      return { sufficient: false, reason: '答案缺少显式片段引用' };
    }

    const citedChunks = [...citedIndexes].map((index) => chunks[index - 1]);
    if (citedChunks.some((chunk) => !chunk)) {
      return { sufficient: false, reason: '答案引用了不存在的片段编号' };
    }

    const tableHeaders = this.getMarkdownTableStructureLines(answer);
    const answerWithoutTableHeaders = answer
      .split('\n')
      .filter((line) => !tableHeaders.has(line.trim()))
      .join('\n');
    const answerTokens = this.extractQualityTokens(
      answerWithoutTableHeaders.replace(/\[片段\s*\d+\]/g, ''),
    );
    if (answerTokens.size === 0) {
      return { sufficient: false, reason: '答案缺少可校验内容' };
    }

    const minCoverage =
      this.configService.get<number>('ragQuality.minCitationCoverage') ?? 0.15;
    const claimGate = this.assessClaimSupport(answer, chunks, minCoverage);
    if (!claimGate.sufficient) {
      return claimGate;
    }

    const citedText = citedChunks.map((chunk) => chunk.content).join('\n');
    const overlap = this.countTokenOverlap(answerTokens, citedText);
    const coverage = overlap / answerTokens.size;
    if (coverage < minCoverage) {
      return {
        sufficient: false,
        reason: `答案内容被引用片段覆盖率 ${coverage.toFixed(
          2,
        )} 低于阈值 ${minCoverage}`,
      };
    }

    return { sufficient: true, reason: '答案引用可被检索片段支撑' };
  }

  private assessClaimSupport(
    answer: string,
    chunks: RetrievedChunk[],
    minCoverage: number,
  ): { sufficient: boolean; reason: string } {
    const tableHeaders = this.getMarkdownTableStructureLines(answer);
    const claims = this.extractClaims(answer);
    for (const claim of claims) {
      if (tableHeaders.has(claim.trim())) continue;
      // 标题、列表前言等只承担组织文本的作用，不表达可核验结论。它们通常以
      // 冒号收尾且没有引用；把它们当事实句会错误否决「前言 + 带引用要点」的
      // 正常回答。此处只按句法结构豁免，不依赖任何业务词或实体名单。
      if (this.isCitationFreeLeadIn(claim)) {
        continue;
      }
      const claimTokens = this.extractQualityTokens(
        claim.replace(/\[片段\s*\d+\]/g, ''),
      );
      if (claimTokens.size < 2) {
        continue;
      }

      const claimCitations = this.extractCitedIndexes(claim);
      if (claimCitations.size === 0) {
        return {
          sufficient: false,
          reason: `关键结论缺少逐句引用：${this.shortenClaim(claim)}`,
        };
      }

      const citedChunks = [...claimCitations].map((index) => chunks[index - 1]);
      if (citedChunks.some((chunk) => !chunk)) {
        return {
          sufficient: false,
          reason: `关键结论引用了不存在的片段：${this.shortenClaim(claim)}`,
        };
      }

      const citedText = citedChunks.map((chunk) => chunk.content).join('\n');
      const coverage =
        this.countTokenOverlap(claimTokens, citedText) / claimTokens.size;
      if (coverage < minCoverage) {
        return {
          sufficient: false,
          reason: `关键结论引用支撑不足：${this.shortenClaim(claim)}`,
        };
      }
    }

    return { sufficient: true, reason: '逐句关键结论引用通过' };
  }

  private isCitationFreeLeadIn(claim: string): boolean {
    if (this.extractCitedIndexes(claim).size > 0) {
      return false;
    }
    return /[：:]$/.test(claim.trim());
  }

  private getMarkdownTableStructureLines(answer: string): Set<string> {
    const lines = answer.split('\n');
    const structureLines = new Set<string>();
    for (let index = 0; index < lines.length; index += 1) {
      const separator = lines[index].trim();
      if (!/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(separator)) {
        continue;
      }

      structureLines.add(separator);
      const header = lines[index - 1]?.trim();
      if (header?.includes('|')) {
        structureLines.add(header);
      }
    }
    return structureLines;
  }

  /**
   * 模型偶尔会遗漏引用格式，但答案文本本身仍可能是可读且受证据支撑的总结。
   * 仅当一条结论与唯一最佳片段有足够覆盖时才补写引用；证据不足不补，仍由
   * 后续门禁拒绝。这是格式修复，不改变模型的事实表述，也不拼接原始片段。
   */
  attachMissingClaimCitations(
    answer: string,
    chunks: RetrievedChunk[],
  ): string {
    if (!answer.trim() || chunks.length === 0) return answer;
    const minCoverage =
      this.configService.get<number>('ragQuality.minCitationCoverage') ?? 0.15;
    return answer.replace(
      /[^。！？!?；;\n]+[。！？!?；;]?(?:\s*\[片段\s*\d+\])*/gu,
      (claim) => {
        const trimmed = claim.trim();
        if (
          !trimmed ||
          this.extractCitedIndexes(trimmed).size > 0 ||
          this.isCitationFreeLeadIn(trimmed)
        ) {
          return claim;
        }
        const tokens = this.extractQualityTokens(trimmed);
        if (tokens.size < 2) return claim;
        const best = chunks
          .map((chunk, index) => ({
            index,
            coverage:
              this.countTokenOverlap(tokens, chunk.content) / tokens.size,
          }))
          .sort((left, right) => right.coverage - left.coverage)[0];
        if (!best || best.coverage < minCoverage) return claim;

        const suffix = claim.match(/\s*$/u)?.[0] ?? '';
        return `${claim.slice(0, claim.length - suffix.length)}[片段${best.index + 1}]${suffix}`;
      },
    );
  }

  private extractClaims(answer: string): string[] {
    const claims =
      answer.match(/[^。！？!?；;\n]+[。！？!?；;]?(?:\s*\[片段\s*\d+\])*/gu) ??
      [];
    return claims.map((claim) => claim.trim()).filter(Boolean);
  }

  private shortenClaim(claim: string): string {
    return claim.length > 40 ? `${claim.slice(0, 40)}...` : claim;
  }

  private extractCitedIndexes(answer: string): Set<number> {
    const indexes = new Set<number>();
    const pattern = /\[片段\s*(\d+)\]/g;
    for (const match of answer.matchAll(pattern)) {
      indexes.add(Number(match[1]));
    }
    return indexes;
  }

  extractQualityTokens(text: string): Set<string> {
    const normalized = this.normalizeQuery(text);
    const rawTokens =
      normalized.match(/[\p{Script=Han}]|[\p{L}\p{N}_-]+/gu) ?? [];
    const stopwords = new Set([
      '的',
      '了',
      '和',
      '是',
      '在',
      '有',
      '这',
      '那',
      '请',
      '什么',
      '如何',
      '以及',
      'the',
      'and',
      'for',
      'with',
      'that',
      'this',
      'what',
      'how',
      'why',
    ]);

    return new Set(
      rawTokens
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .filter((token) => !stopwords.has(token))
        .filter((token) => token.length > 1 || /[\p{Script=Han}]/u.test(token)),
    );
  }

  countTokenOverlap(tokens: Set<string>, text: string): number {
    const targetTokens = this.extractQualityTokens(text);
    let overlap = 0;
    for (const token of tokens) {
      if (targetTokens.has(token)) {
        overlap += 1;
      }
    }
    return overlap;
  }

  private countCjkBigramOverlap(query: string, content: string): number {
    const bigrams = (value: string): Set<string> => {
      const characters = value.match(/[\p{Script=Han}]/gu) ?? [];
      const result = new Set<string>();
      for (let index = 0; index < characters.length - 1; index += 1) {
        result.add(`${characters[index]}${characters[index + 1]}`);
      }
      return result;
    };
    const queryBigrams = bigrams(query);
    const contentBigrams = bigrams(content);
    let overlap = 0;
    for (const bigram of queryBigrams) {
      if (contentBigrams.has(bigram)) overlap += 1;
    }
    return overlap;
  }

  private countWordOverlap(query: string, chunks: RetrievedChunk[]): number {
    const words = (value: string): Set<string> =>
      new Set<string>(
        (
          (value.toLowerCase().match(/[a-z0-9][a-z0-9_-]+/g) ?? []) as string[]
        ).filter((word: string) => word.length > 1),
      );
    const queryWords = words(query);
    const contentWords = new Set(
      chunks.flatMap((chunk) => [...words(chunk.content)]),
    );
    let overlap = 0;
    for (const word of queryWords) {
      if (contentWords.has(word)) overlap += 1;
    }
    return overlap;
  }

  private extractChinesePhraseTokens(text: string): Set<string> {
    const normalized = this.normalizeQuery(text);
    const stopwords = new Set([
      '什么',
      '多少',
      '怎么',
      '如何',
      '需要',
      '哪些',
      '分别',
      '公司',
      '如果',
      '是否',
    ]);
    const phrases = new Set<string>();
    const segments = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];

    for (const segment of segments) {
      if (segment.length <= 4 && !stopwords.has(segment)) {
        phrases.add(segment);
      }
      for (let i = 0; i < segment.length - 1; i += 1) {
        const phrase = segment.slice(i, i + 2);
        if (!stopwords.has(phrase)) {
          phrases.add(phrase);
        }
      }
    }

    return phrases;
  }

  private extractChineseAnchorPhrases(text: string): Set<string> {
    const normalized = this.normalizeQuery(text);
    const stopwords = new Set([
      '什么',
      '哪个',
      '哪些',
      '怎么',
      '如何',
      '需要',
      '分别',
      '公司',
      '项目',
      '资料',
      '文档',
      '系统',
      '标准',
      '规则',
      '时候',
      '时间',
      '关系',
      '作用',
      '负责',
      '报销',
      '查询',
      '介绍',
      '说明',
      '以及',
      '是否',
    ]);
    const phrases = new Set<string>();
    const segments = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];
    for (const segment of segments) {
      if (segment.length <= 4 && !stopwords.has(segment)) {
        phrases.add(segment);
      }
      for (let i = 0; i < segment.length - 1; i += 1) {
        const phrase = segment.slice(i, i + 2);
        if (!stopwords.has(phrase)) phrases.add(phrase);
      }
    }
    return phrases;
  }

  private countChinesePhraseOverlap(tokens: Set<string>, text: string): number {
    const targetTokens = this.extractChinesePhraseTokens(text);
    let overlap = 0;
    for (const token of tokens) {
      if (targetTokens.has(token)) {
        overlap += 1;
      }
    }
    return overlap;
  }
}
