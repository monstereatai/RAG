import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm/llm.provider';
import type { ObsidianSearchHit } from '../../modules/obsidian/obsidian-knowledge.service';
import type {
  RetrievalDiagnostics,
  RetrievedChunk,
} from '../evidence/retrieval.types';
import type { RagAnswerResult } from '../contracts/rag-types';
import { generateAnswerPrompt } from '../prompts/rag.prompts';
import { sanitizeUntrustedContext } from '../prompts/prompt-injection.guard';
import { RagAnswerFallbackService } from './rag-answer-fallback.service';
import { RagEvidenceService } from '../evidence/rag-evidence.service';
import { GroundedAnswerGenerationService } from '../generation/grounded-answer-generation.service';
import { normalizePromptQuery } from '../retrieval/query-normalizer';

export interface RagGroundedAnswerInput {
  query: string;
  normalizedQuery: string;
  evidenceChunks: RetrievedChunk[];
  ragChunks: RetrievedChunk[];
  ragChunkCount: number;
  obsidianChunkCount: number;
  obsidianHits: ObsidianSearchHit[];
  retrievalDiagnostics: RetrievalDiagnostics;
  history: Array<{ role: 'human' | 'ai'; content: string }>;
  generationMemory: Array<{ role: string; content: string }>;
  answerRequirements: string[];
  hasPlannedAnswerRequirements: boolean;
  onToken?: (token: string) => void;
  signal?: AbortSignal;
  preferFastModel?: boolean;
  obsidianGateSufficient: boolean;
}

@Injectable()
export class RagGroundedAnswerService {
  private readonly logger = new Logger(RagGroundedAnswerService.name);

  constructor(
    private readonly llmProvider: LlmProvider,
    private readonly evidenceService: RagEvidenceService,
    private readonly fallbackService: RagAnswerFallbackService,
    private readonly answerGenerationService: GroundedAnswerGenerationService,
  ) {}

  private get answerQuality() {
    return this.evidenceService.answerQuality;
  }

  async generate(input: RagGroundedAnswerInput): Promise<RagAnswerResult> {
    const {
      query,
      normalizedQuery,
      evidenceChunks,
      ragChunks,
      ragChunkCount,
      obsidianChunkCount,
      obsidianHits,
      retrievalDiagnostics,
      history,
      generationMemory,
      answerRequirements,
      hasPlannedAnswerRequirements,
      onToken,
      signal,
      preferFastModel,
      obsidianGateSufficient,
    } = input;

    const context = evidenceChunks
      .map(
        (c, i) =>
          `[片段 ${i + 1}｜${c.contextRole ?? 'hit'}]\n${sanitizeUntrustedContext(c.content)}`,
      )
      .join('\n\n---\n\n');
    this.logger.log(
      `Generating answer with ${ragChunkCount} RAG chunks and ${obsidianChunkCount} Obsidian chunks`,
    );
    const deterministicAnswer = hasPlannedAnswerRequirements
      ? null
      : this.evidenceService.buildDeterministicAnswer(
          normalizedQuery,
          evidenceChunks,
        );
    if (deterministicAnswer) {
      return {
        answer: deterministicAnswer,
        references: this.evidenceService.toReferences(evidenceChunks),
        retrievalSufficient: true,
        retrievalReason: '命中明确结构化事实，已使用片段抽取式回答',
        obsidianPaths: obsidianHits.map((hit) => hit.path),
        obsidianHits,
        retrievalDiagnostics: retrievalDiagnostics,
      };
    }

    const messages = await generateAnswerPrompt.formatMessages({
      context,
      query: normalizePromptQuery(query),
      answerRequirements: this.formatAnswerRequirements(answerRequirements),
      history,
      memory: generationMemory,
    });
    const generationModel = preferFastModel
      ? (this.llmProvider.getAgenticModel?.() ?? this.llmProvider.getModel())
      : this.llmProvider.getModel();
    const stream = this.answerGenerationService.streamModel(
      generationModel,
      messages,
      signal,
    );
    let rawAnswer = '';
    for await (const chunk of stream) {
      const token =
        typeof chunk.content === 'string'
          ? chunk.content
          : JSON.stringify(chunk.content);
      if (!token) continue;
      rawAnswer += token;
      onToken?.(token);
    }
    const answer = this.answerQuality.attachMissingClaimCitations(
      this.fallbackService.addVersionConflictNotice(rawAnswer, ragChunks),
      evidenceChunks,
    );
    if (this.fallbackService.isExplicitNoAnswerResponse(answer)) {
      return {
        answer,
        references: [],
        retrievalSufficient: false,
        retrievalReason: '模型明确判断现有证据不足，已清除引用并进入无答案状态',
        obsidianPaths: obsidianHits.map((hit) => hit.path),
        obsidianHits,
        retrievalDiagnostics: retrievalDiagnostics,
      };
    }
    const citationGate = this.answerQuality.assessCitationSupport(
      answer,
      evidenceChunks,
    );
    if (!citationGate.sufficient) {
      const extractiveFallback = hasPlannedAnswerRequirements
        ? null
        : this.evidenceService.buildCitationSafeExtractiveAnswer(
            normalizedQuery,
            evidenceChunks,
          );
      if (extractiveFallback) {
        const extractiveGate = this.answerQuality.assessCitationSupport(
          extractiveFallback,
          evidenceChunks,
        );
        if (extractiveGate.sufficient) {
          const citedChunks = this.evidenceService.selectCitedChunks(
            extractiveFallback,
            evidenceChunks,
          );
          return {
            answer: extractiveFallback,
            references: this.evidenceService.toReferences(citedChunks),
            retrievalSufficient: true,
            retrievalReason: 'LLM 答案引用不足，已用当前检索证据提取式回答',
            obsidianPaths: obsidianHits.map((hit) => hit.path),
            obsidianHits,
            retrievalDiagnostics: retrievalDiagnostics,
          };
        }
      }
      const synthesizedFallback =
        await this.fallbackService.synthesizeEvidenceAnswer(
          normalizedQuery,
          evidenceChunks,
          signal,
          answerRequirements,
        );
      let repairedSynthesis = synthesizedFallback
        ? this.answerQuality.attachMissingClaimCitations(
            synthesizedFallback,
            evidenceChunks,
          )
        : null;
      let synthesisGate = repairedSynthesis
        ? this.answerQuality.assessCitationSupport(
            repairedSynthesis,
            evidenceChunks,
          )
        : null;
      if (this.llmProvider.getActiveProviderName?.() !== 'qwen') {
        // 首选模型已经在引用门禁失败后进入兜底，不能再接受它刚生成的
        // “看似有引用但混入证据外事实”的结果；统一交给备用模型重新压缩。
        try {
          const qwenSynthesis = await this.llmProvider.runWithModel(
            'qwen',
            () =>
              this.fallbackService.synthesizeEvidenceAnswer(
                normalizedQuery,
                evidenceChunks,
                signal,
                answerRequirements,
              ),
          );
          repairedSynthesis = qwenSynthesis
            ? this.answerQuality.attachMissingClaimCitations(
                qwenSynthesis,
                evidenceChunks,
              )
            : null;
          synthesisGate = repairedSynthesis
            ? this.answerQuality.assessCitationSupport(
                repairedSynthesis,
                evidenceChunks,
              )
            : null;
        } catch (error) {
          this.logger.warn(
            `Qwen semantic fallback failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (repairedSynthesis && synthesisGate?.sufficient) {
        const citedChunks = this.evidenceService.selectCitedChunks(
          repairedSynthesis,
          evidenceChunks,
        );
        return {
          answer: repairedSynthesis,
          references: this.evidenceService.toReferences(citedChunks),
          retrievalSufficient: true,
          retrievalReason: 'LLM 答案引用不足，已用受约束语义总结重新生成',
          obsidianPaths: obsidianHits.map((hit) => hit.path),
          obsidianHits,
          retrievalDiagnostics: retrievalDiagnostics,
        };
      }
      const deterministicFallback = hasPlannedAnswerRequirements
        ? null
        : this.evidenceService.buildEvidenceFirstAnswer(
            normalizedQuery,
            evidenceChunks,
          );
      if (deterministicFallback) {
        const citedChunks = this.evidenceService.selectCitedChunks(
          deterministicFallback,
          evidenceChunks,
        );
        return {
          answer: deterministicFallback,
          references: this.evidenceService.toReferences(citedChunks),
          retrievalSufficient: true,
          retrievalReason: 'LLM 答案引用不足，已回退为结构化事实回答',
          obsidianPaths: obsidianHits.map((hit) => hit.path),
          obsidianHits,
          retrievalDiagnostics: retrievalDiagnostics,
        };
      }

      return {
        answer: this.answerGenerationService.unavailableWithEvidenceAnswer(),
        references: [],
        retrievalSufficient: false,
        retrievalReason: `${citationGate.reason}；受约束语义总结未通过引用门禁，已禁止输出原始片段`,
        obsidianPaths: obsidianHits.map((hit) => hit.path),
        obsidianHits,
        retrievalDiagnostics: retrievalDiagnostics,
      };
    }

    return {
      answer,
      references: this.evidenceService.toReferences(evidenceChunks),
      retrievalSufficient: true,
      retrievalReason: obsidianGateSufficient
        ? `Obsidian fast path 命中；检索片段和答案引用通过本地质量闸门`
        : '检索片段和答案引用通过本地质量闸门',
      obsidianPaths: obsidianHits.map((hit) => hit.path),
      obsidianHits,
      retrievalDiagnostics: retrievalDiagnostics,
    };
  }

  private formatAnswerRequirements(requirements: string[]): string {
    return requirements.length
      ? requirements.map((item, index) => `${index + 1}. ${item}`).join('\n')
      : '无（请从用户问题中逐项拆分）';
  }
}
