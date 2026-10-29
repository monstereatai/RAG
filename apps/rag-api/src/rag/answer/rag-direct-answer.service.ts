import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BadCaseFlywheelService,
  type BadCaseMatch,
} from '../prompts/bad-case-flywheel.service';
import type {
  RetrievedChunk,
  RetrievalScope,
} from '../evidence/retrieval.types';
import type { RagAnswerResult } from '../contracts/rag-types';
import { RagEvidenceService } from '../evidence/rag-evidence.service';
import { RagRetrievalService } from '../retrieval/rag-retrieval.service';
import { retrievalProfileForTaskType } from '../retrieval/context-builder';

@Injectable()
export class RagDirectAnswerService {
  private readonly logger = new Logger(RagDirectAnswerService.name);

  private get answerQuality() {
    return this.evidenceService.answerQuality;
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly badCaseFlywheel: BadCaseFlywheelService,
    private readonly retrievalService: RagRetrievalService,
    private readonly evidenceService: RagEvidenceService,
  ) {}

  async answerDirect(
    query: string,
    history: Array<{ role: 'human' | 'ai'; content: string }> = [],
    userId?: string,
    memoryMessages: Array<{ role: string; content: string }> = [],
    onToken?: (token: string) => void,
    scope?: RetrievalScope,
    signal?: AbortSignal,
    tenantId?: string,
    allowBadCase = true,
    roles: string[] = [],
    departmentIds: string[] = [],
    trustedAdminPrincipal = false,
  ): Promise<RagAnswerResult | null> {
    const normalizedQuery = this.retrievalService.normalizeQuery(query);
    const [exactMatches, direct] = await Promise.all([
      allowBadCase
        ? (this.badCaseFlywheel.retrieveExactMatches?.(
            normalizedQuery,
            1,
            userId,
            tenantId,
          ) ??
          this.badCaseFlywheel.retrieveMatches(
            normalizedQuery,
            1,
            userId,
            tenantId,
          ))
        : Promise.resolve([] as BadCaseMatch[]),
      this.tryGovernedDirectAnswer(
        normalizedQuery,
        userId,
        scope,
        tenantId,
        roles,
        departmentIds,
        trustedAdminPrincipal,
      ),
    ]);
    const exact = exactMatches.find((match) => match.mode === 'exact');
    if (exact) {
      const correctedAnswer = this.evidenceService.extractCorrectedAnswer(
        exact.text,
      );
      if (correctedAnswer) {
        const answer = await this.evidenceService.generateCorrectionAnswer(
          query,
          correctedAnswer,
          history,
          memoryMessages,
          onToken,
          exact.query,
          signal,
        );
        return {
          answer,
          references: [],
          retrievalSufficient: true,
          retrievalReason: `命中已审核 Bad Case 纠错证据（${exact.mode}，${exact.score.toFixed(3)}）`,
        };
      }
    }
    if (direct) onToken?.(direct.answer);
    return direct;
  }

  /**
   * 受治理 受治理直答：仅用于明确事实查询，命中当前生效且覆盖完整的本地编译知识时跳过向量与 LLM。
   */
  async tryGovernedDirectAnswer(
    query: string,
    userId?: string,
    scope?: RetrievalScope,
    tenantId?: string,
    roles: string[] = [],
    departmentIds: string[] = [],
    trustedAdminPrincipal = false,
  ): Promise<RagAnswerResult | null> {
    const profile = retrievalProfileForTaskType('lookup');
    if (profile.intent !== 'lookup') {
      return null;
    }

    try {
      const chunks = await this.retrievalService.retrieveBm25Only(
        query,
        userId,
        scope,
        false,
        tenantId,
        roles,
        departmentIds,
        trustedAdminPrincipal,
      );
      const primary = chunks[0];
      if (
        !primary ||
        !this.isGovernedDirectAnswerCandidate(query, primary, scope)
      ) {
        return null;
      }
      // 编译知识直答只接受领域结构化事实。不能用原始切片补位，否则一个被
      // 路由误标为 lookup 的概括问题就会跳过生成链路并把残句展示给用户。
      const answer = this.evidenceService.buildEvidenceFirstAnswer(query, [
        primary,
      ]);
      if (
        !answer ||
        !this.answerQuality.assessCitationSupport(answer, [primary]).sufficient
      ) {
        return null;
      }
      return {
        answer,
        references: this.evidenceService.toReferences([primary]),
        retrievalSufficient: true,
        retrievalReason:
          '命中受治理 受治理编译知识，已通过权限范围、版本、生效时间、来源与覆盖度校验并直答',
      };
    } catch (error) {
      this.logger.warn(
        `governed direct answer skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private isGovernedDirectAnswerCandidate(
    query: string,
    chunk: RetrievedChunk,
    scope?: RetrievalScope,
  ): boolean {
    if (
      chunk.lifecycleStatus !== 'effective' ||
      !chunk.docId ||
      !chunk.sourceAuthority ||
      !chunk.docVersion
    ) {
      return false;
    }
    if (!this.retrievalService.isLifecycleVisible(chunk, scope)) return false;
    if (/待确认|待补充|未知|TODO/i.test(chunk.content)) return false;

    const queryTokens = this.answerQuality.extractQualityTokens(query);
    if (queryTokens.size === 0) return false;
    const coverage =
      this.answerQuality.countTokenOverlap(queryTokens, chunk.content) /
      queryTokens.size;
    const minCoverage =
      this.configService.get<number>('ragQuality.governedDirectCoverage') ??
      0.7;
    return coverage >= minCoverage;
  }

  unsupportedReliableAnswer(): string {
    return this.evidenceService.unsupportedReliableAnswer();
  }
}
