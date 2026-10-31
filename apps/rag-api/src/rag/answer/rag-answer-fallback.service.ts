import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmProvider } from '../../providers/llm/llm.provider';
import {
  BochaSearchService,
  type BochaSearchResult,
} from '../../tools/bocha-search.service';
import { ToolExecutionPolicyService } from '../../tools/tool-execution-policy.service';
import { GroundedAnswerGenerationService } from '../generation/grounded-answer-generation.service';
import { sanitizeUntrustedContext } from '../prompts/prompt-injection.guard';
import type { ObsidianSearchHit } from '../../modules/obsidian/obsidian-knowledge.service';
import { isObjectiveKnowledgePlan } from '../planning/query-plan';
import type { RetrievedChunk } from '../evidence/retrieval.types';
import type { RagAnswerResult, RetrieveOptions } from '../contracts/rag-types';
import { rethrowIfAborted } from '../../common/errors/abort.util';
import { getPromptMetadata } from '../prompts/prompt-registry';
import {
  ragFallbackPromptDefinitions,
  renderRagFallbackPrompt,
} from './rag-fallback.prompts';

@Injectable()
export class RagAnswerFallbackService {
  private readonly logger = new Logger(RagAnswerFallbackService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly llmProvider: LlmProvider,
    private readonly bochaSearchService: BochaSearchService,
    private readonly toolPolicy: ToolExecutionPolicyService,
    private readonly answerGenerationService: GroundedAnswerGenerationService,
  ) {}

  async answerWithWebFallback(
    query: string,
    reason: string,
    history: Array<{ role: 'human' | 'ai'; content: string }>,
    memoryMessages: Array<{ role: string; content: string }>,
    onToken?: (token: string) => void,
    retrieveOptions: RetrieveOptions = {},
  ): Promise<{
    answer: string;
    references: RagAnswerResult['references'];
  } | null> {
    if (retrieveOptions.knowledgeOnly) return null;
    const policy = this.toolPolicy.decide('bocha_web_search', {
      mode: 'simple',
      pluginKeys: retrieveOptions.pluginKeys,
      allowedToolNames: retrieveOptions.pluginTools,
    });
    if (!policy.allowed || !this.bochaSearchService.isEnabled()) return null;

    try {
      const maxResults =
        this.configService.get<number>('agentic.maxWebSearchResults') ?? 5;
      const results = retrieveOptions.signal
        ? await this.bochaSearchService.search(
            query,
            maxResults,
            retrieveOptions.signal,
          )
        : await this.bochaSearchService.search(query, maxResults);
      if (!results.length) return null;
      const references = results.map((result, index) =>
        this.toWebChunk(result, index),
      );
      const context = references
        .map(
          (item, index) =>
            `[网页来源 ${index + 1}]\n${sanitizeUntrustedContext(item.content)}`,
        )
        .join('\n\n---\n\n');
      const answer = await this.generateWebFallbackAnswer(
        query,
        reason,
        context,
        history,
        memoryMessages,
        onToken,
        retrieveOptions.signal,
      );
      // 对齐引用类型：web 来源同样携带 score（=totalScore）
      return {
        answer,
        references: references.map((chunk) => ({
          ...chunk,
          score: chunk.totalScore,
        })),
      };
    } catch (error) {
      rethrowIfAborted(error, retrieveOptions.signal);
      this.logger.warn(
        `Simple web fallback failed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private toWebChunk(result: BochaSearchResult, index: number): RetrievedChunk {
    const content = [
      `标题：${result.title}`,
      `来源：${result.siteName ?? result.url}`,
      result.datePublished ? `发布时间：${result.datePublished}` : '',
      result.summary ? `摘要：${result.summary}` : '',
      result.snippet ? `片段：${result.snippet}` : '',
      `URL：${result.url}`,
    ]
      .filter(Boolean)
      .join('\n');
    return {
      id: `web:${result.url}`,
      content,
      docId: result.url,
      chunkIndex: index,
      bm25Score: 0,
      cosineScore: 0,
      totalScore: 0.15,
      retrievalSource: 'web',
      contextRole: 'hit',
    };
  }

  private async generateWebFallbackAnswer(
    query: string,
    reason: string,
    context: string,
    history: Array<{ role: 'human' | 'ai'; content: string }>,
    memoryMessages: Array<{ role: string; content: string }>,
    onToken?: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const historyText = history
      .slice(-6)
      .map(
        (item) => `${item.role === 'human' ? '用户' : '助手'}：${item.content}`,
      )
      .join('\n');
    const memoryText = memoryMessages
      .slice(-6)
      .map((item) => `${item.role}：${item.content}`)
      .join('\n');
    const prompt = renderRagFallbackPrompt(
      ragFallbackPromptDefinitions.webSearchAnswer,
      {
        reason,
        context,
        history: historyText || '无',
        memory: memoryText || '无',
        query,
      },
    );
    const stream = this.streamModel(
      this.llmProvider.getModel(),
      prompt,
      signal,
      undefined,
      getPromptMetadata('rag.fallback.web_search_answer'),
    );
    let answer = '';
    for await (const chunk of stream) {
      const token =
        typeof chunk.content === 'string'
          ? chunk.content
          : JSON.stringify(chunk.content);
      if (!token) continue;
      answer += token;
      onToken?.(token);
    }
    return answer.trim();
  }

  async generateModelFallbackAnswer(
    query: string,
    reason: string,
    history: Array<{ role: 'human' | 'ai'; content: string }> = [],
    memoryMessages: Array<{ role: string; content: string }> = [],
    onToken?: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const today = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      dateStyle: 'full',
    }).format(new Date());
    const historyText = history
      .slice(-6)
      .map(
        (item) => `${item.role === 'human' ? '用户' : '助手'}：${item.content}`,
      )
      .join('\n');
    const memoryText = memoryMessages
      .slice(-6)
      .map((item) => `${item.role}：${item.content}`)
      .join('\n');

    const prompt = renderRagFallbackPrompt(
      ragFallbackPromptDefinitions.webAnswer,
      {
        today,
        reason,
        memory: memoryText || '无',
        history: historyText || '无',
        query,
      },
    );

    try {
      const stream = this.streamModel(
        this.llmProvider.getModel(),
        prompt,
        signal,
        undefined,
        getPromptMetadata('rag.fallback.web_answer'),
      );
      let answer = '';
      for await (const chunk of stream) {
        const token =
          typeof chunk.content === 'string'
            ? chunk.content
            : JSON.stringify(chunk.content);
        if (!token) continue;
        answer += token;
        onToken?.(token);
      }
      return answer.trim();
    } catch {
      const answer = await this.invokeModel(
        prompt,
        signal,
        getPromptMetadata('rag.fallback.web_answer'),
      );
      onToken?.(answer);
      return answer.trim();
    }
  }

  async generateObsidianAnswer(
    query: string,
    hits: ObsidianSearchHit[],
    history: Array<{ role: 'human' | 'ai'; content: string }> = [],
    memoryMessages: Array<{ role: string; content: string }> = [],
    onToken?: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const historyText = history
      .slice(-6)
      .map(
        (item) => `${item.role === 'human' ? '用户' : '助手'}：${item.content}`,
      )
      .join('\n');
    const memoryText = memoryMessages
      .slice(-6)
      .map((item) => `${item.role}：${item.content}`)
      .join('\n');
    const context = hits
      .map(
        (hit, index) =>
          `[片段 ${index + 1}]\n${hit.title}\npath: ${hit.path}\n${sanitizeUntrustedContext(hit.content)}`,
      )
      .join('\n\n---\n\n');
    const prompt = renderRagFallbackPrompt(
      ragFallbackPromptDefinitions.obsidianAnswer,
      {
        memory: memoryText || '无',
        history: historyText || '无',
        context,
        query,
      },
    );

    try {
      const stream = this.streamModel(
        this.llmProvider.getModel(),
        prompt,
        signal,
        undefined,
        getPromptMetadata('rag.fallback.obsidian_answer'),
      );
      let answer = '';
      for await (const chunk of stream) {
        const token =
          typeof chunk.content === 'string'
            ? chunk.content
            : JSON.stringify(chunk.content);
        if (!token) continue;
        answer += token;
        onToken?.(token);
      }
      return answer.trim();
    } catch {
      const answer = await this.invokeModel(
        prompt,
        signal,
        getPromptMetadata('rag.fallback.obsidian_answer'),
      );
      onToken?.(answer);
      return answer.trim();
    }
  }

  isExplicitNoAnswerResponse(answer: string): boolean {
    const normalized = answer.replace(/\s+/g, ' ').trim();
    if (normalized.length === 0) return false;
    return (
      /^(片段中未提及|当前没有找到足以支撑|知识库中没有)/.test(normalized) ||
      normalized.includes('完全没有记录')
    );
  }

  addVersionConflictNotice(answer: string, chunks: RetrievedChunk[]): string {
    return this.answerGenerationService.addVersionConflictNotice(
      answer,
      chunks,
    );
  }

  /**
   * LLM 答案未通过引用门禁时，用同一批证据做一次受约束的语义压缩。
   * 这是“不要直接输出检索片段”的最后一道自然语言兜底；
   * 如果模型不可用或仍不能通过引用校验，再回退到确定性抽取式答案。
   */
  async synthesizeEvidenceAnswer(
    query: string,
    chunks: RetrievedChunk[],
    signal?: AbortSignal,
    answerRequirements: string[] = [],
  ): Promise<string | null> {
    return this.answerGenerationService.synthesizeEvidenceAnswer(
      query,
      chunks,
      signal,
      answerRequirements,
    );
  }

  buildArithmeticAnswer(
    query: string,
    history: Array<{ role: 'human' | 'ai'; content: string }>,
  ): string | null {
    if (!/(?:等于多少|等于几|结果是多少|怎么计算)[？?]?$/u.test(query)) {
      return null;
    }
    const match = query.match(/(\d+(?:\.\d+)?)\s*([+\-*/×÷])\s*(\d+)/u);
    if (!match) return null;
    const left = Number(match[1]);
    const right = Number(match[3]);
    const result =
      match[2] === '+'
        ? left + right
        : match[2] === '-'
          ? left - right
          : match[2] === '*' || match[2] === '×'
            ? left * right
            : left / right;
    const settings = history
      .filter((item) => item.role === 'human' && /等于|=/u.test(item.content))
      .slice(-5)
      .map((item) => item.content);
    return settings.length
      ? `客观事实：${left}${match[2]}${right}等于${result}。\n历史对话设定：${settings.join('；')}`
      : `客观事实：${left}${match[2]}${right}等于${result}。`;
  }

  async generateConversationStateAnswer(
    query: string,
    history: Array<{ role: 'human' | 'ai'; content: string }>,
    onToken?: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const latest = history
      .filter((item) => item.role === 'human')
      .at(-1)?.content;
    if (!latest) return null;
    const prompt = renderRagFallbackPrompt(
      ragFallbackPromptDefinitions.conversationState,
      { latest, query },
    );
    try {
      const answer = (
        await this.invokeModel(
          prompt,
          signal,
          getPromptMetadata('rag.fallback.conversation_state'),
        )
      ).trim();
      if (answer) onToken?.(answer);
      return answer || null;
    } catch {
      return null;
    }
  }

  async generateMixedContextAnswer(
    query: string,
    history: Array<{ role: 'human' | 'ai'; content: string }>,
    onToken?: (token: string) => void,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const statements = history
      .filter((item) => item.role === 'human')
      .map((item) => item.content)
      .slice(-5);
    if (!statements.length) return null;
    const arithmetic = query.match(
      /(\d+(?:\.\d+)?)\s*([+\-*/×÷])\s*(\d+(?:\.\d+)?)/u,
    );
    if (arithmetic) {
      const left = Number(arithmetic[1]);
      const right = Number(arithmetic[3]);
      const result =
        arithmetic[2] === '+'
          ? left + right
          : arithmetic[2] === '-'
            ? left - right
            : arithmetic[2] === '*' || arithmetic[2] === '×'
              ? left * right
              : left / right;
      const answer = `客观事实：${left}${arithmetic[2]}${right}等于${result}。\n历史对话设定：${statements.join('；')}`;
      onToken?.(answer);
      return answer;
    }
    const prompt = renderRagFallbackPrompt(
      ragFallbackPromptDefinitions.mixedContext,
      {
        statements: statements
          .map((item, index) => `${index + 1}. ${item}`)
          .join('\n'),
        query,
      },
    );
    try {
      const answer = (
        await this.invokeModel(
          prompt,
          signal,
          getPromptMetadata('rag.fallback.mixed_context'),
        )
      ).trim();
      if (answer) onToken?.(answer);
      return answer || null;
    } catch {
      return `客观事实：当前问题缺少可验证的具体实体资料。\n历史对话设定：${statements.join('；')}`;
    }
  }

  async answerWithModelFallback(
    query: string,
    history: Array<{ role: 'human' | 'ai'; content: string }>,
    onToken: ((token: string) => void) | undefined,
    options: RetrieveOptions,
  ): Promise<{ answer: string } | null> {
    if (
      options.knowledgeOnly ||
      options.sourcePolicy === 'local_only' ||
      options.executionPlan?.sourcePolicy === 'local_only'
    ) {
      return null;
    }
    const plan = options.queryPlan;
    const canUseGeneralModel = plan
      ? isObjectiveKnowledgePlan(plan)
      : options.executionPlan
        ? options.executionPlan.sourcePolicy === 'web_allowed' ||
          options.executionPlan.sourcePolicy === 'direct_answer'
        : false;
    if (!canUseGeneralModel || plan?.contextMode === 'setting') {
      return null;
    }
    const prompt = renderRagFallbackPrompt(
      ragFallbackPromptDefinitions.generalAnswer,
      {
        history:
          history
            .filter((item) => item.role === 'human')
            .slice(-5)
            .map((item) => item.content)
            .join('；') || '无',
        query,
      },
    );
    const metadata = getPromptMetadata('rag.fallback.general_answer');
    const providers: Array<'default' | 'qwen'> = ['default'];
    if (this.llmProvider.getActiveProviderName?.() !== 'qwen') {
      providers.push('qwen');
    }
    for (const provider of providers) {
      try {
        const answer = (
          provider === 'qwen'
            ? await this.llmProvider.invoke(prompt, 'qwen', {
                ...(options.signal ? { signal: options.signal } : {}),
                metadata,
              })
            : await this.invokeModel(prompt, options.signal, metadata)
        ).trim();
        if (!answer) continue;
        onToken?.(answer);
        return { answer };
      } catch {
        // 首选模型返回空正文或调用失败时，继续尝试备用通用模型。
      }
    }
    return null;
  }

  private invokeModel(
    prompt: string,
    signal?: AbortSignal,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    return this.llmProvider.invoke(prompt, {
      ...(signal ? { signal } : {}),
      ...(metadata ? { metadata } : {}),
    });
  }

  async *streamModel(
    model: ReturnType<LlmProvider['getModel']>,
    input: Parameters<ReturnType<LlmProvider['getModel']>['stream']>[0],
    signal?: AbortSignal,
    onFallback?: () => void,
    metadata?: Record<string, unknown>,
  ) {
    yield* this.answerGenerationService.streamModel(
      model,
      input,
      signal,
      onFallback,
      metadata,
    );
  }

  hasConversationEntityEvidence(
    chunks: RetrievedChunk[],
    entities?: string[],
  ): boolean {
    if (!entities?.length || !chunks.length) return false;
    return entities.some((entity) =>
      chunks.some((chunk) => chunk.content.includes(entity)),
    );
  }
}
