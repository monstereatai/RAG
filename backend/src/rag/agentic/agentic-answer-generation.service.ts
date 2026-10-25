import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm/llm.provider';
import {
  KarpathyRagService,
  type RetrieveOptions,
  type RetrievedChunk,
} from '../karpathy/karpathy-rag.service';
import { AgentLoopService } from '../../modules/agent-loop/agent-loop.service';
import { BadCaseFlywheelService } from '../prompts/bad-case-flywheel.service';
import type { AgenticRagStateType } from './agentic-rag.state';
import { buildAnswerArtifacts } from './answer-artifacts';
import { getSubQuestionCoverage } from './agentic-rag-planning';
import type { SseCallback } from './sse-event';

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
    private readonly karpathyRagService: KarpathyRagService,
    private readonly badCaseFlywheel: BadCaseFlywheelService,
    private readonly agentLoop: AgentLoopService,
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
      ? this.karpathyRagService.extractCorrectedAnswer(strongBadCase.text)
      : '';
    if (strongBadCase && correction) {
      const answer = await this.karpathyRagService.generateCorrectionAnswer(
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
      const ans = this.karpathyRagService.unsupportedReliableAnswer();
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
      const deterministicGate =
        this.karpathyRagService.validateAnswerCitationSupport(
          deterministicEvidenceAnswer,
          state.retrievedChunks,
        );
      if (deterministicGate.sufficient) {
        const citedChunks = this.karpathyRagService.selectCitedChunks(
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
                await this.karpathyRagService.generateGroundedAnswer(
                  state.query,
                  state.retrievedChunks,
                  history,
                  generationMemory,
                  (token) => onEvent?.({ type: 'token', data: token }),
                  {
                    userId,
                    scope: retrieveOptions.scope,
                    entities: retrieveOptions.entities,
                    needsSynthesis: retrieveOptions.needsSynthesis,
                    answerRequirements:
                      retrieveOptions.queryPlan?.subQueries ?? [],
                    preferAgenticModel: true,
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
              this.karpathyRagService.validateAnswerCitationSupport(
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
        ? this.karpathyRagService.repairAnswerCitations(
            fallbackAnswer,
            state.retrievedChunks,
          )
        : null;
      let fallbackGate = repairedFallbackAnswer
        ? this.karpathyRagService.validateAnswerCitationSupport(
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
            ? this.karpathyRagService.repairAnswerCitations(
                qwenAnswer,
                state.retrievedChunks,
              )
            : null;
          fallbackGate = repairedFallbackAnswer
            ? this.karpathyRagService.validateAnswerCitationSupport(
                repairedFallbackAnswer,
                state.retrievedChunks,
              )
            : null;
        } catch (error) {
          this.logger.warn(
            `Qwen semantic fallback failed: ${(error as Error).message}`,
          );
        }
      }

      if (repairedFallbackAnswer && fallbackGate?.sufficient) {
        const citedChunks = this.karpathyRagService.selectCitedChunks(
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

      const safeAnswer = this.karpathyRagService.unsupportedReliableAnswer();
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

    const citedChunks = this.karpathyRagService.selectCitedChunks(
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
    if (chunks.length === 0) return null;
    const evidence = chunks
      .slice(0, 6)
      .map(
        (chunk, index) =>
          `[片段${index + 1}] ${chunk.content.slice(0, 900).replace(/\s+/g, ' ')}`,
      )
      .join('\n\n');
    const requirements = answerRequirements.length
      ? answerRequirements
          .map((item, index) => `${index + 1}. ${item}`)
          .join('\n')
      : '无（请从用户问题中逐项拆分）';
    const prompt = `你是企业知识库问答的证据编辑。只根据下列证据回答问题，不要逐段转抄，不要补充证据外事实。先直接给结论，再用不超过三句概括关键依据。若问题包含多个并列事项，必须逐项回答并分别引用对应片段；某一项缺证据时只对该项说明“片段中未提及”，不能只回答其中最相关的一项。每个结论句末必须标注对应的[片段N]；没有可靠依据就只回答“当前资料不足以确认该结论。”\n\n必答事项（如未提供，请从用户问题中逐项拆分）：\n${requirements}\n\n问题：${query}\n\n证据：\n${evidence}`;
    try {
      const answer = await this.withTimeout(
        this.llmProvider.invoke(prompt, {
          signal: this.composeSignal(signal, 20_000),
        }),
        20_000,
        'Evidence synthesis fallback',
      );
      if (answer.trim()) return answer.trim();
      if (this.llmProvider.getActiveProviderName() !== 'qwen') {
        const fallback = await this.withTimeout(
          this.llmProvider.runWithModel('qwen', () =>
            this.llmProvider.invoke(prompt, {
              signal: this.composeSignal(signal, 20_000),
            }),
          ),
          20_000,
          'Qwen evidence synthesis fallback',
        );
        return fallback.trim() || null;
      }
      return null;
    } catch (error) {
      this.logger.warn(
        `Evidence synthesis fallback failed: ${(error as Error).message}`,
      );
      if (this.llmProvider.getActiveProviderName() !== 'qwen') {
        try {
          const fallback = await this.withTimeout(
            this.llmProvider.runWithModel('qwen', () =>
              this.llmProvider.invoke(prompt, {
                signal: this.composeSignal(signal, 20_000),
              }),
            ),
            20_000,
            'Qwen evidence synthesis fallback',
          );
          return fallback.trim() || null;
        } catch (fallbackError) {
          this.logger.warn(
            `Qwen evidence synthesis fallback failed: ${(fallbackError as Error).message}`,
          );
        }
      }
      return null;
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timeout after ${ms}ms`)),
        ms,
      );
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private composeSignal(signal: AbortSignal | undefined, timeoutMs: number) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  }
}
