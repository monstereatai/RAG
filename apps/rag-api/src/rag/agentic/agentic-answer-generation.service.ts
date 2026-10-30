import { Inject, Injectable, Logger } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm/llm.provider';
import type { RetrieveOptions } from '../contracts/rag-types';
import type { RetrievedChunk } from '../evidence/retrieval.types';
import { EvidencePolicyService } from '../evidence/evidence-policy.service';
import { AGENTIC_RETRIEVAL_CAPABILITY, type AgenticRetrievalCapability } from '../contracts/agentic-rag-capabilities';
import { GroundedAnswerGenerationService } from '../generation/grounded-answer-generation.service';
import { AgentLoopService } from '../../modules/agent-loop/agent-loop.service';
import { BadCaseFlywheelService } from '../prompts/bad-case-flywheel.service';
import type { AgenticRagStateType } from './agentic-rag.state';
import { buildAnswerArtifacts } from './answer-artifacts';
import { getSubQuestionCoverage } from './agentic-rag-planning';
import type { SseCallback } from './sse-event';
import { rethrowIfAborted } from '../../common/errors/abort.util';

export interface AgenticAnswerGenerationContext {
  onEvent?: SseCallback;
  history: Array<{ role: 'human' | 'ai'; content: string }>;
  memoryMessages: Array<{ role: string; content: string }>;
  retrieveOptions: RetrieveOptions;
  userId?: string;
  threadId?: string;
  runId?: string;
  buildEvidenceFirstAnswer: (
    query: string,
    chunks: RetrievedChunk[],
  ) => string | null;
}

@Injectable()
export class AgenticAnswerGenerationService {
  private readonly logger = new Logger('AgenticRagService');

  constructor(
    private readonly llmProvider: LlmProvider,
    private readonly groundedAnswerGeneration: GroundedAnswerGenerationService,
    private readonly evidencePolicy: EvidencePolicyService,
    private readonly badCaseFlywheel: BadCaseFlywheelService,
    private readonly agentLoop: AgentLoopService,
    @Inject(AGENTIC_RETRIEVAL_CAPABILITY)
    private readonly retrievalCapability: AgenticRetrievalCapability,
  ) {}

  /**
   * 生成节点：基于检索结果生成答案
   */
  async generate(
    state: AgenticRagStateType,
    context: AgenticAnswerGenerationContext,
  ): Promise<Partial<AgenticRagStateType>> {
    const {
      onEvent,
      history,
      memoryMessages,
      retrieveOptions,
      userId,
      threadId,
      runId,
      buildEvidenceFirstAnswer,
    } = context;
    const badCaseMatches = state.badCaseMatches ?? [];
    const badCasePrompt = badCaseMatches.length
      ? this.badCaseFlywheel.formatPrompt(badCaseMatches)
      : '';
    const generationMemory = [
      ...memoryMessages,
      ...(badCasePrompt ? [{ role: 'system', content: badCasePrompt }] : []),
      ...(state.reflectionFeedback
        ? [
            {
              role: 'system',
              content: `上次答案评估未通过，请按下面意见修正，并逐项覆盖必答事项：${state.reflectionFeedback.slice(0, 500)}`,
            },
          ]
        : []),
    ];
    const hasPlannedAnswerRequirements = Boolean(
      retrieveOptions.queryPlan?.subQueries.length,
    );
    const deterministicEvidenceAnswer = hasPlannedAnswerRequirements
      ? null
      : buildEvidenceFirstAnswer(state.query, state.retrievedChunks);
    // 多项问题即使整体充分性判断偏保守，只要已经召回受权限约束的证据，
    // 仍让生成器逐项回答；缺证据的项目会明确标出，不应整题直接拒答。
    const effectiveRetrievalSufficient =
      state.retrievalSufficient ||
      Boolean(deterministicEvidenceAnswer) ||
      (hasPlannedAnswerRequirements && state.retrievedChunks.length > 0);
    const strongBadCase = badCaseMatches.find(
      (match) => match.mode === 'exact',
    );
    const correction = strongBadCase
      ? this.groundedAnswerGeneration.extractCorrectedAnswer(
          strongBadCase.text,
        )
      : '';
    if (strongBadCase && correction) {
      const answer = await this.groundedAnswerGeneration.generateCorrectionAnswer(
        state.query,
        correction,
        history,
        memoryMessages,
        (token) => onEvent?.({ type: 'token', data: token }),
        strongBadCase.query,
        retrieveOptions.signal,
      );
      onEvent?.({ type: 'citation', data: state.retrievedChunks });
      const artifacts = buildAnswerArtifacts(
        state,
        answer,
        true,
        1,
        '命中已审核 Bad Case 纠错答案',
      );
      onEvent?.({ type: 'artifact', data: artifacts[artifacts.length - 1] });
      return {
        answer,
        retrievalSufficient: true,
        retrievalReason: `命中已审核 Bad Case 纠错证据（${strongBadCase.mode}，${strongBadCase.score.toFixed(3)}）`,
        artifacts,
      };
    }

    if (state.retrievedChunks.length === 0 || !effectiveRetrievalSufficient) {
      const reason =
        state.retrievedChunks.length === 0
          ? '没有检索到任何可用片段'
          : state.retrievalReason || '检索不足';
      const ans = this.groundedAnswerGeneration.unsupportedReliableAnswer();
      onEvent?.({ type: 'token', data: ans });
      onEvent?.({ type: 'citation', data: [] });
      const artifacts = buildAnswerArtifacts(
        state,
        ans,
        false,
        0,
        '本地与联网证据不足，已进入安全降级',
      );
      onEvent?.({ type: 'artifact', data: artifacts[artifacts.length - 1] });
      return {
        answer: ans,
        retrievedChunks: [],
        retrievalSufficient: false,
        retrievalReason: `${reason}；本地与联网证据不足，已进入安全降级`,
        artifacts,
      };
    }

    if (deterministicEvidenceAnswer) {
      const deterministicGate = this.evidencePolicy.validateAnswerCitationSupport(
        deterministicEvidenceAnswer,
        state.retrievedChunks,
      );
      if (deterministicGate.sufficient) {
        const citedChunks = this.evidencePolicy.selectCitedChunks(
          deterministicEvidenceAnswer,
          state.retrievedChunks,
        );
        onEvent?.({ type: 'token', data: deterministicEvidenceAnswer });
        onEvent?.({ type: 'citation', data: citedChunks });
        const artifacts = buildAnswerArtifacts(
          state,
          deterministicEvidenceAnswer,
          true,
          getSubQuestionCoverage(state),
          '结构化证据可直接回答，跳过模型生成与反思',
        );
        onEvent?.({ type: 'artifact', data: artifacts[artifacts.length - 1] });
        return {
          answer: deterministicEvidenceAnswer,
          retrievedChunks: citedChunks,
          retrievalSufficient: true,
          retrievalReason: '结构化证据可直接回答，跳过模型生成与反思',
          artifacts,
        };
      }
    }

    type GenerationLoopState = {
      answer: string;
      citationGate?: { sufficient: boolean; reason: string };
    };
    // 有界生成循环固定为“生成草稿→引用校验→完成”；引用门禁是工具步骤，不由模型自行宣告通过。
    const loop = await this.agentLoop.run<
      GenerationLoopState,
      GenerationLoopState
    >({
      threadId: threadId || 'agentic-rag',
      runId,
      actor: 'agentic_answer',
      initialState: { answer: '' },
      maxSteps: 3,
      maxToolCalls: 1,
      timeoutMs: 90_000,
      decide: (loopState) => {
        if (!loopState.answer) {
          return {
            type: 'model' as const,
            name: 'generate_grounded_answer',
            execute: async () => {
              const grounded =
                await this.groundedAnswerGeneration.generateGroundedAnswer(
                  state.query,
                  this.retrievalCapability.prepareGroundedEvidence(
                    state.retrievedChunks,
                    retrieveOptions.scope,
                  ),
                  history,
                  generationMemory,
                  (token) => onEvent?.({ type: 'token', data: token }),
                  {
                    answerRequirements:
                      retrieveOptions.queryPlan?.subQueries ?? [],
                    preferAgenticModel: true,
                    protectedMemoryMessageCount: Math.min(
                      2,
                      memoryMessages.length,
                    ),
                    signal: retrieveOptions.signal,
                  },
                );
              return grounded.answer;
            },
            reduce: (current: GenerationLoopState, answer: string) => ({
              ...current,
              answer,
            }),
          };
        }
        if (!loopState.citationGate) {
          return {
            type: 'tool' as const,
            name: 'citation_validate',
            mode: 'agentic' as const,
            ownerUserId: userId,
            input: {
              answerLength: loopState.answer.length,
              evidenceCount: state.retrievedChunks.length,
            },
            execute: async () =>
              this.evidencePolicy.validateAnswerCitationSupport(
                loopState.answer,
                state.retrievedChunks,
              ),
            reduce: (
              current: GenerationLoopState,
              citationGate: { sufficient: boolean; reason: string },
            ) => ({ ...current, citationGate }),
          };
        }
        return {
          type: 'complete' as const,
          output: loopState,
          reason: loopState.citationGate.sufficient
            ? '引用门禁通过'
            : loopState.citationGate.reason,
        };
      },
    });
    if (loop.status !== 'completed' || !loop.output?.citationGate) {
      throw new Error(`Agent Loop 未完成：${loop.terminationReason}`);
    }
    let answer = loop.output.answer;
    let citationGate = loop.output.citationGate;
    // Agentic 的多轮总结可能把结构化事实中的数字、单位或实体名压缩掉。
    // 如果同一批已授权证据能够生成通过引用门禁的确定性答案，优先采用它，
    // 保证复杂链路和 Simple 对可核验事实保持一致。
    const deterministicAnswer = hasPlannedAnswerRequirements
      ? null
      : deterministicEvidenceAnswer;
    if (deterministicAnswer) {
      // 结构化答案只由当前 evidenceChunks 的固定字段组成，片段编号也是同一
      // 批证据的局部编号；引用门禁的 LLM/覆盖率波动不能否定这类确定性结果。
      answer = deterministicAnswer;
      citationGate = {
        sufficient: true,
        reason: '结构化证据答案使用当前片段字段并保留局部引用',
      };
    }
    if (!citationGate.sufficient) {
      // 不能把候选原文片段伪装成回答。首次生成未通过引用门禁时，使用同一批
      // 证据做一次更短、更受约束的语义压缩；仍失败则安全降级。
      const fallbackAnswer = await this.synthesizeEvidenceAnswer(
        state.query,
        state.retrievedChunks,
        retrieveOptions.signal,
        retrieveOptions.queryPlan?.subQueries ?? [],
      );
      let repairedFallbackAnswer = fallbackAnswer
        ? this.evidencePolicy.repairAnswerCitations(
            fallbackAnswer,
            state.retrievedChunks,
          )
        : null;
      let fallbackGate = repairedFallbackAnswer
        ? this.evidencePolicy.validateAnswerCitationSupport(
            repairedFallbackAnswer,
            state.retrievedChunks,
          )
        : null;

      // DeepSeek 在部分本地配置下会返回非空但不可引用的短句；这不是证据不足，
      // 而是生成器结果不可用。此时必须显式切换到 Qwen 重新做同一批证据的语义总结，
      // 不能把“引用门禁失败”直接暴露给用户。
      if (this.llmProvider.getActiveProviderName() !== 'qwen') {
        // 首选模型已经未通过引用门禁，不能继续接受其可能混入证据外事实的
        // 语义总结；统一切换备用模型重新压缩同一批证据。
        try {
          const qwenAnswer = await this.llmProvider.runWithModel('qwen', () =>
            this.synthesizeEvidenceAnswer(
              state.query,
              state.retrievedChunks,
              retrieveOptions.signal,
              retrieveOptions.queryPlan?.subQueries ?? [],
            ),
          );
          repairedFallbackAnswer = qwenAnswer
            ? this.evidencePolicy.repairAnswerCitations(
                qwenAnswer,
                state.retrievedChunks,
              )
            : null;
          fallbackGate = repairedFallbackAnswer
            ? this.evidencePolicy.validateAnswerCitationSupport(
                repairedFallbackAnswer,
                state.retrievedChunks,
              )
            : null;
        } catch (error) {
          rethrowIfAborted(error, retrieveOptions.signal);
          this.logger.warn(
            `Qwen semantic fallback failed: ${(error as Error).message}`,
          );
        }
      }

      if (repairedFallbackAnswer && fallbackGate?.sufficient) {
        const citedChunks = this.evidencePolicy.selectCitedChunks(
          repairedFallbackAnswer,
          state.retrievedChunks,
        );
        onEvent?.({ type: 'token', data: repairedFallbackAnswer });
        onEvent?.({ type: 'citation', data: citedChunks });
        const artifacts = buildAnswerArtifacts(
          state,
          repairedFallbackAnswer,
          true,
          getSubQuestionCoverage(state),
          '证据语义总结通过引用校验',
        );
        onEvent?.({
          type: 'artifact',
          data: artifacts[artifacts.length - 1],
        });
        return {
          answer: repairedFallbackAnswer,
          retrievalSufficient: true,
          retrievalReason: '首选模型答案不可用，已切换备用模型完成证据总结',
          artifacts,
        };
      }

      const safeAnswer = this.groundedAnswerGeneration.unsupportedReliableAnswer();
      onEvent?.({ type: 'token', data: safeAnswer });
      onEvent?.({ type: 'citation', data: [] });
      const artifacts = buildAnswerArtifacts(
        state,
        safeAnswer,
        false,
        0,
        citationGate.reason,
      );
      onEvent?.({ type: 'artifact', data: artifacts[artifacts.length - 1] });
      return {
        answer: safeAnswer,
        retrievedChunks: [],
        retrievalSufficient: false,
        retrievalReason: citationGate.reason,
        passed: true,
        artifacts,
      };
    }

    const citedChunks = this.evidencePolicy.selectCitedChunks(
      answer,
      state.retrievedChunks,
    );
    onEvent?.({ type: 'citation', data: citedChunks });
    const artifacts = buildAnswerArtifacts(
      state,
      answer,
      true,
      getSubQuestionCoverage(state),
      '答案通过引用和子问题覆盖校验',
    );
    onEvent?.({ type: 'artifact', data: artifacts[artifacts.length - 1] });
    return {
      answer,
      retrievedChunks: citedChunks,
      retrievalSufficient: true,
      retrievalReason: deterministicAnswer
        ? '结构化证据答案使用当前片段字段并保留局部引用'
        : undefined,
      artifacts,
    };
  }

  private async synthesizeEvidenceAnswer(
    query: string,
    chunks: RetrievedChunk[],
    signal?: AbortSignal,
    answerRequirements: string[] = [],
  ): Promise<string | null> {
    return this.groundedAnswerGeneration.synthesizeAgenticEvidenceAnswer(query, chunks, signal, answerRequirements);
  }
}
