import { z } from 'zod';
import type { RetrieveOptions } from '../contracts/rag-types';
import type { RetrievedChunk } from '../evidence/retrieval.types';
import { SseCallback } from './sse-event';
import {
  type AgenticRagStateType,
  type AnswerContractArtifactPayload,
} from './agentic-rag.state';
import {
  reflectionPrompt,
  sufficiencyPrompt,
} from '../prompts/agentic.prompts';
import { getPromptMetadata } from '../prompts/prompt-registry';
import { RunnableConfig } from '@langchain/core/runnables';
import {
  appliesToQuery,
  type EvidenceBundle,
} from '../evidence/evidence-bundle';
import { buildSubQuestions } from './agentic-rag-planning';
import { AgenticRagRetrieval } from './agentic-rag.retrieval';
const MAX_WEB_RESULT_CONTEXT_CHARACTERS = 2_000;

export class AgenticRagEvidence extends AgenticRagRetrieval {
  /**
   * 检索充分性评估
   */
  async sufficiencyNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    const retrieveOptions = (config?.configurable?.retrieveOptions ??
      {}) as RetrieveOptions;
    const subQuestions = state.subQuestions?.length
      ? state.subQuestions
      : buildSubQuestions(
          state.query,
          state.augmentedQueries,
          this.getSubQuestionLimit(config),
        );
    const fastPathBundle = config?.configurable?.fastPathBundle as
      | EvidenceBundle
      | undefined;
    // 对单一原问题，Fast Path 已经完成了权限过滤、混合检索和语义充分性判断。
    // Agentic 的“拆题”只是执行细节，不能使用不同问法把该结论推翻。
    if (
      fastPathBundle &&
      appliesToQuery(fastPathBundle, state.query) &&
      fastPathBundle.assessment.sufficient &&
      subQuestions.length <= 1
    ) {
      const reason = `复用统一证据包：${fastPathBundle.assessment.reason}`;
      const resolvedSubQuestions = subQuestions.map((subQuestion) => ({
        ...subQuestion,
        sufficient: true,
        status: 'sufficient' as const,
        reason,
        evidenceIds:
          subQuestion.evidenceIds.length > 0
            ? subQuestion.evidenceIds
            : fastPathBundle.chunks.map((chunk) => chunk.id),
      }));
      onEvent?.({
        type: 'sufficiency',
        data: { sufficient: true, reason, evidenceBundle: true },
      });
      return {
        retrievedChunks:
          state.retrievedChunks.length > 0
            ? state.retrievedChunks
            : fastPathBundle.chunks,
        retrievalSufficient: true,
        retrievalReason: reason,
        subQuestions: resolvedSubQuestions,
      };
    }
    const chunksById = new Map(
      state.retrievedChunks.map((chunk) => [chunk.id, chunk]),
    );
    const deterministicEvidenceAnswer = this.buildEvidenceFirstAnswer(
      state.query,
      state.retrievedChunks,
    );
    // 这些答案由当前 state 的结构化片段和固定字段匹配生成，引用编号也在同一
    // 批片段内；不再让一次不稳定的“语义充分性”判定把确定性证据重新打回不足。
    const deterministicEvidenceGate = Boolean(deterministicEvidenceAnswer);
    const evaluatedSubQuestions = subQuestions.map((subQuestion) => {
      const evidence = subQuestion.evidenceIds
        .map((id) => chunksById.get(id))
        .filter((chunk): chunk is RetrievedChunk => Boolean(chunk));
      const gate = this.assessRetrievedChunks(
        subQuestion.question,
        evidence,
        retrieveOptions.queryPlan?.taskType,
      );
      return {
        ...subQuestion,
        sufficient: gate.sufficient || deterministicEvidenceGate,
        status:
          gate.sufficient || deterministicEvidenceGate
            ? ('sufficient' as const)
            : ('needs_more' as const),
        reason: deterministicEvidenceGate
          ? '结构化证据可直接回答，保留当前片段进入生成与引用门禁'
          : gate.reason,
      };
    });
    const unresolved = evaluatedSubQuestions.filter((item) => !item.sufficient);

    if (state.retrievedChunks.length === 0 || unresolved.length > 0) {
      const res = {
        retrievalSufficient: false,
        retrievalReason:
          state.retrievedChunks.length === 0
            ? '没有检索到任何可用片段'
            : `仍有 ${unresolved.length} 个子问题缺少直接证据：${unresolved.map((item) => item.question).join('；')}`,
        subQuestions: evaluatedSubQuestions,
      };
      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient: res.retrievalSufficient,
          reason: res.retrievalReason,
        },
      });
      return res;
    }

    const localGate = this.assessRetrievedChunks(
      state.query,
      state.retrievedChunks,
      retrieveOptions.queryPlan?.taskType,
    );
    if (!localGate.sufficient) {
      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient: false,
          reason: localGate.reason,
        },
      });
      return {
        retrievalSufficient: false,
        retrievalReason: localGate.reason,
        subQuestions: evaluatedSubQuestions,
      };
    }

    if (
      this.sufficiencyFastPathEnabled &&
      evaluatedSubQuestions.every((item) => item.sufficient)
    ) {
      const reason =
        '本地质量门禁与子问题证据均已通过，跳过冗余的模型充分性判断';
      onEvent?.({
        type: 'sufficiency',
        data: { sufficient: true, reason, fastPath: true },
      });
      return {
        retrievalSufficient: true,
        retrievalReason: reason,
        subQuestions: evaluatedSubQuestions.map((item) => ({
          ...item,
          sufficient: true,
          status: 'sufficient' as const,
        })),
      };
    }

    const model = this.llmProvider.getModel();
    const schema = z.object({
      sufficient: z.boolean().describe('检索片段是否足够直接支撑回答用户问题'),
      reason: z.string().describe('中文评估理由'),
    });

    try {
      const structured = model.withStructuredOutput(schema);
      const chain = sufficiencyPrompt.pipe(structured);
      const budget = await this.fitEvidenceToPromptBudget(
        state.retrievedChunks,
        500,
        (context) =>
          sufficiencyPrompt.formatMessages({
            query: state.query,
            context,
          }),
      );
      if (!budget.withinBudget) {
        throw new Error(
          `充分性评估的固定提示词和问题已超过输入预算：${budget.estimatedInputTokens}/${budget.maxInputTokens} tokens`,
        );
      }
      if (budget.removedChunks > 0) {
        this.logger.warn(
          `Sufficiency prompt evidence trimmed to token budget: removed=${budget.removedChunks}, tokens=${budget.estimatedInputTokens}/${budget.maxInputTokens}`,
        );
      }
      const result = await chain.invoke(
        {
          query: state.query,
          context: budget.context,
        },
        {
          signal: config?.configurable?.abortSignal as AbortSignal | undefined,
          metadata: getPromptMetadata('agentic.sufficiency'),
        },
      );

      this.logger.log(
        `Retrieval sufficiency: sufficient=${result.sufficient}, reason=${result.reason}`,
      );

      const deterministicAnswer = deterministicEvidenceAnswer;
      const sufficient = result.sufficient || Boolean(deterministicAnswer);
      const resolvedReason =
        sufficient && !result.sufficient && deterministicAnswer
          ? '结构化证据可直接回答，保留当前片段进入生成与引用门禁'
          : result.reason;

      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient,
          reason: resolvedReason,
        },
      });

      return {
        retrievalSufficient: sufficient,
        retrievalReason: resolvedReason,
        subQuestions: evaluatedSubQuestions.map((item) => ({
          ...item,
          sufficient: sufficient && item.sufficient,
          status: sufficient && item.sufficient ? 'sufficient' : 'needs_more',
        })),
      };
    } catch (err) {
      await this.rethrowIfAbortedOrCancelled(err, config);
      // 结构化充分性判断失败时复用统一质量门禁；不能再用更高的硬编码分数阈值，
      // 否则已通过关键词覆盖的网页证据会因 0.15 < 0.20 被错误拒答。
      const fallbackGate = this.assessRetrievedChunks(
        state.query,
        state.retrievedChunks,
        retrieveOptions.queryPlan?.taskType,
      );
      const sufficient = fallbackGate.sufficient;
      const reason = `充分性 LLM 评估失败，按检索质量门禁判断：${fallbackGate.reason}`;
      this.logger.warn(`${reason}: ${(err as Error).message}`);

      onEvent?.({
        type: 'sufficiency',
        data: {
          sufficient,
          reason,
        },
      });

      return {
        retrievalSufficient: sufficient,
        retrievalReason: reason,
        subQuestions: evaluatedSubQuestions,
      };
    }
  }

  /**
   * 联网兜底
   */
  async webSearchFallbackNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType> & { webSearchCount: number }> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    const retrieveOptions = (config?.configurable?.retrieveOptions ??
      {}) as RetrieveOptions;
    if (
      retrieveOptions.knowledgeOnly ||
      retrieveOptions.sourcePolicy !== 'web_allowed'
    ) {
      const reason = `${state.retrievalReason || '本地检索不足'}；当前问题限定使用资料库，已跳过联网搜索`;
      onEvent?.({
        type: 'web_search',
        data: { count: 0, enabled: false, reason },
      });
      return {
        retrievalReason: reason,
        webSearchCount: 0,
        webSearchAttempted: true,
      };
    }
    if (state.retrievalSufficient) {
      return { webSearchCount: 0 };
    }

    if (
      !this.webSearchFallbackEnabled ||
      !this.bochaSearchService.isEnabled() ||
      !this.toolPolicy.decide(
        'bocha_web_search',
        this.pluginPolicy(config, 'agentic'),
      ).allowed
    ) {
      this.logger.warn(
        'Retrieval insufficient but Bocha web_search is disabled or budgeted off',
      );
      const reason = `${state.retrievalReason || '检索不足'}；联网兜底未启用或 BOCHA_API_KEY 未配置，已跳过`;
      onEvent?.({
        type: 'web_search',
        data: {
          count: 0,
          enabled:
            this.webSearchFallbackEnabled &&
            this.bochaSearchService.isEnabled(),
          reason,
        },
      });
      return {
        retrievalReason: reason,
        webSearchCount: 0,
        webSearchAttempted: true,
      };
    }

    try {
      const subQuestions = state.subQuestions?.length
        ? state.subQuestions
        : buildSubQuestions(
            state.query,
            state.augmentedQueries,
            this.getSubQuestionLimit(config),
          );
      const unresolved = subQuestions.filter((item) => !item.sufficient);
      const searchQuestions = unresolved.length
        ? unresolved.slice(0, this.getSubQuestionLimit(config))
        : [{ question: state.query }];
      const threadId = this.threadIdFromConfig(config);
      const searchResults = await Promise.all(
        searchQuestions.map(async (item) => ({
          question: item.question,
          results:
            this.maxWebSearchResults > 0
              ? await this.executeAgenticTool(
                  'bocha_web_search',
                  threadId,
                  this.userIdFromConfig(config),
                  { question: item.question, count: this.maxWebSearchResults },
                  (signal) =>
                    this.bochaSearchService.search(
                      item.question,
                      this.maxWebSearchResults,
                      signal ??
                        (config?.configurable?.abortSignal as
                          | AbortSignal
                          | undefined),
                    ),
                  config,
                )
              : [],
        })),
      );
      const webIdsByQuestion = new Map<string, string[]>();
      const webChunks: RetrievedChunk[] = [];
      const maxResultsPerQuestion = Math.max(
        ...searchResults.map(({ results }) => results.length),
        0,
      );
      // 轮转合并：候选上限较小时，先保证每个子问题至少保留一条网页证据，再补充同题的更多结果。
      for (
        let resultIndex = 0;
        resultIndex < maxResultsPerQuestion;
        resultIndex += 1
      ) {
        for (const { results } of searchResults) {
          const result = results[resultIndex];
          if (!result) continue;
          const metadata = [
            `标题：${this.limitToolContextText(result.title, 300)}`,
            `来源：${this.limitToolContextText(result.siteName ?? result.url, 250)}`,
            result.datePublished
              ? `发布时间：${this.limitToolContextText(result.datePublished, 100)}`
              : '',
            `URL：${this.limitToolContextText(result.url, 500)}`,
          ].filter(Boolean);
          const excerpt = [result.summary, result.snippet]
            .filter(Boolean)
            .join('\n');
          const excerptBudget = Math.max(
            0,
            MAX_WEB_RESULT_CONTEXT_CHARACTERS -
              metadata.join('\n').length -
              '网页摘要与片段：\n'.length,
          );
          const excerptPreview = this.limitToolContextText(
            excerpt,
            excerptBudget,
          );
          const parts = [
            ...metadata,
            excerptPreview ? `网页摘要与片段：${excerptPreview}` : '',
          ].filter(Boolean);

          webChunks.push({
            id: `web:${result.url}`,
            content: parts.join('\n'),
            docId: result.url,
            chunkIndex: resultIndex,
            bm25Score: 0,
            cosineScore: 0,
            totalScore: 0.15,
          });
        }
      }
      for (const { question, results } of searchResults) {
        webIdsByQuestion.set(
          question,
          results.map((result) => `web:${result.url}`),
        );
      }

      this.logger.log(`Bocha web_search returned ${webChunks.length} results`);
      const reason = `${state.retrievalReason || '检索不足'}；已通过 Bocha web_search 补充 ${webChunks.length} 条结果`;
      onEvent?.({
        type: 'web_search',
        data: {
          count: webChunks.length,
          enabled: true,
          reason,
        },
      });
      return {
        // 本地召回已占满上限时，网页补证必须优先进入后续重排和引用阶段，不能在末尾被 slice 丢弃。
        retrievedChunks: [...webChunks, ...state.retrievedChunks].slice(
          0,
          this.maxRetrievedChunks,
        ),
        subQuestions: subQuestions.map((item) => ({
          ...item,
          evidenceIds: [
            ...item.evidenceIds,
            ...(webIdsByQuestion.get(item.question) ?? []),
          ],
          status: webIdsByQuestion.has(item.question)
            ? ('retrieved' as const)
            : item.status,
        })),
        retrievalReason: reason,
        webSearchCount: webChunks.length,
        webSearchAttempted: true,
      };
    } catch (err) {
      await this.rethrowIfAbortedOrCancelled(err, config);
      const reason = `Bocha web_search 调用失败：${(err as Error).message}`;
      this.logger.warn(reason);
      const fallbackReason = `${state.retrievalReason || '检索不足'}；${reason}`;
      onEvent?.({
        type: 'web_search',
        data: {
          count: 0,
          enabled:
            this.webSearchFallbackEnabled &&
            this.bochaSearchService.isEnabled(),
          reason: fallbackReason,
        },
      });
      return {
        retrievalReason: fallbackReason,
        webSearchCount: 0,
        webSearchAttempted: true,
      };
    }
  }

  /**
   * 生成节点：基于检索结果生成答案
   */
  async generateNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    return this.answerGenerationService.generate(state, {
      onEvent: config?.configurable?.onEvent as SseCallback | undefined,
      history: (config?.configurable?.history ?? []) as Array<{
        role: 'human' | 'ai';
        content: string;
      }>,
      memoryMessages: (config?.configurable?.memoryMessages ?? []) as Array<{
        role: string;
        content: string;
      }>,
      retrieveOptions: (config?.configurable?.retrieveOptions ??
        {}) as RetrieveOptions,
      userId: this.userIdFromConfig(config),
      threadId: this.threadIdFromConfig(config),
      runId: this.runIdFromConfig(config),
      buildEvidenceFirstAnswer: (query, chunks) =>
        this.buildEvidenceFirstAnswer(query, chunks),
    });
  }

  /**
   * Reflection 节点：评估答案置信度，决定是否重试
   */
  async reflectionNode(
    state: AgenticRagStateType,
    config?: RunnableConfig,
  ): Promise<Partial<AgenticRagStateType>> {
    const onEvent = config?.configurable?.onEvent as SseCallback | undefined;
    if (!state.retrievalSufficient) {
      onEvent?.({
        type: 'reflection',
        data: {
          // 安全降级代表「没有编造答案」，不是「答案结论可信」。
          confidence: 0,
          passed: true,
          retryCount: state.retryCount,
          reason: '本地与联网证据不足时已进入安全降级，不再生成无证据答案',
        },
      });
      return { confidence: 0, passed: true, retryCount: state.retryCount };
    }

    const answerContract = [...(state.artifacts ?? [])]
      .reverse()
      .find((artifact) => artifact.type === 'answer_contract');
    const contractPayload = answerContract?.payload as
      | AnswerContractArtifactPayload
      | undefined;
    if (contractPayload && !contractPayload.valid) {
      const retryCount = state.retryCount + 1;
      const reason = `答案契约校验未通过：${contractPayload.reason}`;
      onEvent?.({
        type: 'reflection',
        data: {
          confidence: 0,
          passed: false,
          retryCount,
          reason,
        },
      });
      return {
        confidence: 0,
        passed: false,
        retryCount,
        reflectionFeedback: reason.slice(0, 500),
        retryTarget: 'generate',
      };
    }

    if (
      this.reflectionFastPathEnabled &&
      contractPayload?.valid === true &&
      contractPayload.citationSupported === true &&
      contractPayload.subQuestionCoverage >= 1
    ) {
      onEvent?.({
        type: 'reflection',
        data: {
          confidence: 0.9,
          passed: true,
          retryCount: state.retryCount,
          reason: '答案契约和引用覆盖已通过，跳过冗余的模型反思调用',
          fastPath: true,
        },
      });
      return {
        confidence: 0.9,
        passed: true,
        retryCount: state.retryCount,
      };
    }

    const model = this.llmProvider.getModel();

    const schema = z.object({
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe(
          '答案置信度 0~1：是否完整回答了问题、是否有引用支撑、是否编造',
        ),
      reason: z.string().describe('评估理由（中文）'),
      retryTarget: z
        .enum(['generate', 'retrieval'])
        .default('generate')
        .describe('现有证据足够时重新生成，证据缺失时重新检索'),
    });

    try {
      const structured = model.withStructuredOutput(schema);
      const chain = reflectionPrompt.pipe(structured);
      const budget = await this.fitEvidenceToPromptBudget(
        state.retrievedChunks,
        800,
        (context) =>
          reflectionPrompt.formatMessages({
            query: state.query,
            context,
            answer: state.answer,
          }),
      );
      if (!budget.withinBudget) {
        throw new Error(
          `反思评估的固定提示词、问题和答案已超过输入预算：${budget.estimatedInputTokens}/${budget.maxInputTokens} tokens`,
        );
      }
      if (budget.removedChunks > 0) {
        this.logger.warn(
          `Reflection prompt evidence trimmed to token budget: removed=${budget.removedChunks}, tokens=${budget.estimatedInputTokens}/${budget.maxInputTokens}`,
        );
      }
      const result = await chain.invoke(
        {
          query: state.query,
          context: budget.context,
          answer: state.answer,
        },
        {
          signal: config?.configurable?.abortSignal as AbortSignal | undefined,
          metadata: getPromptMetadata('agentic.reflection'),
        },
      );

      const passed = result.confidence >= this.confidenceThreshold;
      const retryCount = state.retryCount + 1;

      this.logger.log(
        `Reflection: confidence=${result.confidence.toFixed(2)}, passed=${passed}, retry=${retryCount}/${this.maxRetries}, reason=${result.reason}`,
      );

      onEvent?.({
        type: 'reflection',
        data: {
          confidence: result.confidence,
          passed,
          retryCount,
          reason: result.reason,
        },
      });

      return {
        confidence: result.confidence,
        passed,
        retryCount,
        reflectionFeedback: passed
          ? ''
          : `答案需要补充或修正：${result.reason}`.slice(0, 500),
        retryTarget: result.retryTarget,
      };
    } catch (err) {
      await this.rethrowIfAbortedOrCancelled(err, config);
      this.logger.warn(
        `Reflection failed, treat confidence as unknown and retry safely: ${(err as Error).message}`,
      );
      const retryCount = state.retryCount + 1;
      onEvent?.({
        type: 'reflection',
        data: {
          confidence: 0,
          passed: false,
          retryCount,
          reason: '反思评估失败，不能确认答案可信度',
        },
      });
      return {
        confidence: 0,
        passed: false,
        retryCount,
        reflectionFeedback:
          '反思评估失败，请重新核对原问题的每个要求并逐项作答。',
        retryTarget: 'generate',
      };
    }
  }
}
