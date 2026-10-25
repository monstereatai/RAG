import { sanitizeUntrustedContext } from '../prompts/prompt-injection.guard';
import type { AnswerQualityService } from './answer-quality.service';
import type { RetrievedChunk } from './karpathy-rag.service';

/** 从已授权证据中抽取可直接回答的事实，并在模型答案不合格时提供带引用的原文兜底。 */
export class DeterministicAnswerBuilder {
  constructor(
    private readonly answerQuality: Pick<
      AnswerQualityService,
      'extractQualityTokens' | 'countTokenOverlap'
    >,
  ) {}

  buildEvidenceFirstAnswer(
    query: string,
    chunks: RetrievedChunk[],
  ): string | null {
    // 直答只能来自可验证的结构化事实。人物介绍、总结和分析统一进入带引用的生成链路。
    return this.buildDeterministicAnswer(query, chunks);
  }

  buildDeterministicAnswer(
    query: string,
    chunks: RetrievedChunk[],
  ): string | null {
    const questionParts = this.splitStructuredQuestion(query);
    const candidates = chunks.flatMap((chunk, index) =>
      this.extractEvidenceSentences(chunk.content).map((sentence) => {
        const scores = questionParts.map((part) => {
          const domains = this.structuredEvidenceDomains(part);
          return domains.length > 0 &&
            this.structuredEvidenceSupportsQuery(part, sentence)
            ? this.scoreStructuredEvidence(sentence, domains, part)
            : 0;
        });
        return {
          sentence,
          index,
          scores,
          score: Math.max(...scores, 0),
        };
      }),
    );
    const matchesByPart = questionParts.map((part, partIndex) =>
      candidates.filter(
        (candidate) =>
          candidate.scores[partIndex] >= 3 &&
          this.structuredEvidenceSupportsQuery(part, candidate.sentence),
      ),
    );
    // 结构化抽取只在每个子问题都有对应证据时成立，避免把一个子问题的命中误当成整句多问题都已回答。
    if (
      matchesByPart.some((matches) => matches.length === 0) ||
      questionParts.length === 0
    ) {
      return null;
    }
    const selected = matchesByPart
      .flat()
      .sort(
        (left, right) => right.score - left.score || left.index - right.index,
      )
      .filter(
        (candidate, index, all) =>
          all.findIndex((item) => item.sentence === candidate.sentence) ===
          index,
      );
    if (!selected.length) return null;
    return selected
      .map(({ sentence, index }) => `${sentence}[片段${index + 1}]`)
      .join('\n');
  }

  private splitStructuredQuestion(query: string): string[] {
    const parts = query
      .split(/[？?；;。]/u)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length <= 1) return parts.length > 0 ? parts : [query.trim()];

    // 多问题经常只在首句写出业务域，后续句子依赖上下文。把原问题中的域词带入子问题，避免拆句后丢失检索约束。
    const contextTerms =
      query.match(
        /薪资|薪酬|工资|收入|发薪|发放|差旅|住宿|报销|采购|付款|票据|发票|合同|法务|审查|保留|日志|审计凭证|okr|绩效|奖金|react|状态管理|组件|nestjs|provider|注入|模块/giu,
      ) ?? [];
    return parts.map((part) =>
      this.structuredEvidenceDomains(part).length > 0 ||
      contextTerms.length === 0
        ? part
        : `${part} ${Array.from(new Set(contextTerms)).join(' ')}`,
    );
  }

  private structuredEvidenceSupportsQuery(
    query: string,
    sentence: string,
  ): boolean {
    const targetRules: Array<[RegExp, RegExp]> = [
      [/税|纳税|个税|所得税|社保/u, /税|纳税|个税|所得税|社保/u],
      [/发放|发薪|什么时候|何时|哪天/u, /发放|发薪|每月|按月|\d+\s*日/u],
      [/保留|期限|多久|多少年|多少天/u, /保留|期限|\d+\s*(?:天|年|月)/u],
      [
        /上限|额度|金额|多少元|多少钱|多少万/u,
        /上限|额度|金额|\d+\s*(?:元|万)/u,
      ],
      [/谁|负责人|审批人/u, /负责人|审批|由.{0,8}(?:人|部门)/u],
      [/版本|哪一版|生效/u, /版本|\d{4}\s*版|生效|优先/u],
    ];
    const targetMatched = targetRules.every(
      ([questionPattern, evidencePattern]) =>
        !questionPattern.test(query) || evidencePattern.test(sentence),
    );
    if (!targetMatched) return false;
    if (
      /[不未无非]|条件|前提|除非|如果|若|如|禁止|不得|才能|仅当/u.test(query)
    ) {
      return /不|未|无|非|条件|前提|除非|如果|若|如|禁止|不得|才能|仅当/u.test(
        sentence,
      );
    }
    return true;
  }

  /** 领域模式只用于决定是否适合抽取证据，不保存任何业务事实。 */
  private structuredEvidenceDomains(query: string): RegExp[] {
    const domains: Array<[RegExp, RegExp]> = [
      [/薪资|薪酬|工资|收入|发薪|发放/, /工资|薪资|薪酬|收入|发薪|发放/],
      [/差旅|住宿/, /差旅|住宿|报销/],
      [/采购|\bpo\b|付款|票据|发票/i, /采购|\bpo\b|付款|票据|发票/i],
      [/合同|法务|审查/, /合同|法务|审查|违约|跨境|个人信息/],
      [/保留|日志|审计凭证/, /保留|日志|审计凭证/],
      [/okr|绩效|奖金/i, /okr|绩效|奖金/i],
      [/react|状态管理|组件/i, /react|zustand|context|react query/i],
      [
        /nestjs|provider|注入|模块/i,
        /nestjs|provider|providers|inject|configservice/i,
      ],
    ];
    return domains
      .filter(([queryPattern]) => queryPattern.test(query))
      .map(([, evidencePattern]) => evidencePattern);
  }

  private scoreStructuredEvidence(
    sentence: string,
    domains: RegExp[],
    query: string,
  ): number {
    const domainScore = domains.reduce(
      (score, pattern) => score + (pattern.test(sentence) ? 2 : 0),
      0,
    );
    const factScore =
      /\d|必须|应当|优先|有效|保留|发放|审批|注入|缓存|状态/.test(sentence)
        ? 1
        : 0;
    const versionResolutionScore =
      /历史|冲突|怎么办|优先/.test(query) && /优先|生效|冲突/.test(sentence)
        ? 2
        : 0;
    return domainScore + factScore + versionResolutionScore;
  }

  private extractEvidenceSentences(text: string): string[] {
    const sentences: string[] = [];
    let heading = '';

    for (const rawLine of text.replace(/\|/g, ' ').split(/\n+/u)) {
      const line = rawLine.trim();
      if (!line || /^path:\s*/i.test(line)) continue;
      if (/\.md$/i.test(line) || /^---+$/.test(line)) continue;
      if (/^\[\[.+\]\]\s*:?\s*$/.test(line)) continue;
      if (/^-\s*\[\[.+\]\]\s*$/.test(line)) continue;

      const pathMatch = line.match(/^章节路径：(.+)$/);
      if (pathMatch) {
        heading =
          pathMatch[1]
            .split('>')
            .map((item) => item.trim())
            .filter(Boolean)
            .pop() ?? heading;
        continue;
      }

      const headingMatch = line.match(/^#+\s*(.+)$/);
      if (headingMatch) {
        heading = headingMatch[1].trim();
        continue;
      }

      const parts = line
        .split(/(?<=[。！？!?；;])\s*/u)
        .map((item) => item.trim())
        .filter(Boolean);

      for (const part of parts) {
        const sentence =
          heading && !part.includes(heading) ? `${heading}：${part}` : part;
        if (sentence.length >= 8) {
          sentences.push(sentence);
        }
      }
    }

    return sentences;
  }

  /** 最后兜底只从本轮已授权片段中抽原文，并保留片段编号供前端回链。 */
  buildCitationSafeExtractiveAnswer(
    query: string,
    chunks: RetrievedChunk[],
  ): string | null {
    const queryTokens = this.answerQuality.extractQualityTokens(query);
    if (
      queryTokens.size === 0 ||
      chunks.length === 0 ||
      !/[\p{Script=Han}]/u.test(query)
    ) {
      return null;
    }
    const minOverlap = Math.max(
      1,
      Math.min(3, Math.ceil(queryTokens.size * 0.18)),
    );
    const unsafeInstruction =
      /忽略.{0,20}(规则|指令)|系统提示|system\s*prompt|越权|泄露.{0,10}(提示|密钥)/i;
    const candidates = chunks.flatMap((chunk, chunkIndex) =>
      this.extractEvidenceSentences(sanitizeUntrustedContext(chunk.content))
        .map((sentence) => ({
          chunkIndex,
          sentence: sentence.slice(0, 280),
          overlap: this.answerQuality.countTokenOverlap(queryTokens, sentence),
          score: chunk.totalScore,
        }))
        .filter(
          (candidate) =>
            candidate.overlap >= minOverlap &&
            /[\p{Script=Han}]/u.test(candidate.sentence) &&
            !unsafeInstruction.test(candidate.sentence),
        ),
    );
    const selected: Array<(typeof candidates)[number]> = [];
    const usedChunks = new Set<number>();
    for (const candidate of candidates.sort(
      (left, right) => right.overlap - left.overlap || right.score - left.score,
    )) {
      if (usedChunks.has(candidate.chunkIndex)) continue;
      selected.push(candidate);
      usedChunks.add(candidate.chunkIndex);
      if (selected.length === 3) break;
    }
    if (selected.length === 0) return null;
    return [
      '资料中的直接依据：',
      ...selected.map(
        (candidate) =>
          `- ${candidate.sentence}[片段${candidate.chunkIndex + 1}]`,
      ),
    ].join('\n');
  }
}
