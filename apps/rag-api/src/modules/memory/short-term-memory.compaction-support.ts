import { SystemMessage } from '@langchain/core/messages';
import { randomUUID } from 'node:crypto';
import { IsNull } from 'typeorm';
import { countTextTokens } from '../document/chunking.util';
import { getPromptVersion } from '../../rag/prompts/prompt-registry';
import {
  shortTermSummaryCompactionSystemPrompt,
  shortTermSummaryRecoverySystemPrompt,
} from './memory.prompts';
import { ShortTermMemoryStorageSupport } from './short-term-memory.storage-support';
import {
  COMPACTION_LOCK_TTL_SECONDS,
  COMPACTION_RETAINED_MESSAGE_RATIO,
  COMPACTION_STRATEGY_CONFIDENCE_THRESHOLD,
  COMPACTION_TARGET_TOKEN_RATIO,
  DEFAULT_MESSAGE_SAFETY_CAP,
  MAX_HISTORY_CONTEXT_TOKENS,
  SUMMARY_MAX_DIGEST_CHARACTERS,
  SUMMARY_MAX_GOAL_CHARACTERS,
  SUMMARY_MAX_ITEM_CHARACTERS,
  SUMMARY_MAX_LIST_ITEMS,
  SUMMARY_RECOVERY_CHUNK_TOKEN_BUDGET,
  SUMMARY_RECOVERY_MESSAGE_PART_CHARACTERS,
  SUMMARY_RECOVERY_PAGE_SIZE,
  SUMMARY_RECOVERY_PREVIOUS_TOKEN_BUDGET,
  SUMMARY_RECOVERY_RECENT_MESSAGE_COUNT,
  TTL_SECONDS,
  type CompactionStrategy,
  type ContextCompactionAudit,
  type RemovalStrategy,
  type StoredTurn,
  type StructuredMemorySummary,
  structuredMemorySummarySchema,
} from './short-term-memory.shared';

export abstract class ShortTermMemoryCompactionSupport extends ShortTermMemoryStorageSupport {
  protected readonly summaryRecoveryInFlight = new Map<
    string,
    Promise<string | null>
  >();

  limitHistoryToTokenBudget<T extends { content: string; role?: string }>(
    turns: T[],
    tokenBudget: number,
    maxMessages = DEFAULT_MESSAGE_SAFETY_CAP,
  ): T[] {
    let usedTokens = 0;
    let start = turns.length;
    while (start > 0 && turns.length - start < maxMessages) {
      const nextTokens = this.estimateTokens(turns[start - 1].content) + 4;
      if (usedTokens + nextTokens > tokenBudget) break;
      usedTokens += nextTokens;
      start -= 1;
    }
    // 不把 assistant 回复和它的 user 问题拆开；宁可少带一条 assistant。
    while (start < turns.length && turns[start].role === 'assistant') {
      start += 1;
    }
    return turns.slice(start);
  }

  async trimAndSummarize(
    conversationId: string,
    maxMessages = DEFAULT_MESSAGE_SAFETY_CAP,
    reason: ContextCompactionAudit['reason'] = 'manual',
    tokenBudget = MAX_HISTORY_CONTEXT_TOKENS,
  ): Promise<ContextCompactionAudit | null> {
    if (!this.redis.isEnabled()) return null;

    const lockKey = this.compactionLockKey(conversationId);
    const lockValue = randomUUID();
    if (
      !(await this.redis.setIfAbsent(
        lockKey,
        lockValue,
        COMPACTION_LOCK_TTL_SECONDS,
      ))
    ) {
      return null;
    }

    const lockRenewal = setInterval(() => {
      void this.redis.renewLock(
        lockKey,
        lockValue,
        COMPACTION_LOCK_TTL_SECONDS,
      );
    }, 60_000);
    lockRenewal.unref?.();
    try {
      return await this.trimAndSummarizeLocked(
        conversationId,
        maxMessages,
        reason,
        tokenBudget,
      );
    } finally {
      clearInterval(lockRenewal);
      await this.redis.releaseLock(lockKey, lockValue);
    }
  }

  protected async trimAndSummarizeLocked(
    conversationId: string,
    maxMessages: number,
    reason: ContextCompactionAudit['reason'],
    tokenBudget: number,
  ): Promise<ContextCompactionAudit | null> {
    const key = this.turnsKey(conversationId);
    const all = await this.redis.zrange(key, 0, -1);

    const existingSummary = await this.redis.get(
      this.summaryKey(conversationId),
    );
    const summaryTokens = existingSummary
      ? this.estimateTokens(
          this.formatSummary(
            existingSummary,
            Math.min(1_500, Math.max(0, tokenBudget - 12)),
          ),
        ) + 12
      : 0;
    const targetTokenBudget = Math.floor(
      Math.max(0, tokenBudget) * COMPACTION_TARGET_TOKEN_RATIO,
    );
    const rawHistoryBudget = Math.max(0, targetTokenBudget - summaryTokens);
    const retainedMessageLimit = Math.min(
      maxMessages,
      Math.max(2, Math.ceil(all.length * COMPACTION_RETAINED_MESSAGE_RATIO)),
    );
    const turns = all.map((raw) => JSON.parse(raw) as StoredTurn);
    const selection = this.selectCompactionMessages(
      turns,
      retainedMessageLimit,
      rawHistoryBudget,
    );
    if (selection.removeIndexes.length === 0) return null;

    const toTrim = selection.removeIndexes.map((index) => all[index]);
    const retainedCount = all.length - toTrim.length;

    const trimmedContent = toTrim
      .map((r) => {
        const t = JSON.parse(r) as StoredTurn;
        return `${t.role}: ${t.content}`;
      })
      .join('\n');

    const audit: ContextCompactionAudit = {
      id: randomUUID(),
      status: 'started',
      reason,
      sourceTurnCount: toTrim.length,
      retainedTurnCount: retainedCount,
      sourceTokenEstimate: this.estimateTokens(trimmedContent),
      baseStrategy: selection.baseStrategy,
      selectedStrategy: selection.strategy,
      strategyConfidence: selection.confidence,
      ...(selection.adaptiveComparison
        ? { adaptiveComparison: selection.adaptiveComparison }
        : {}),
      createdAt: new Date().toISOString(),
    };
    await this.saveAudit(conversationId, audit);
    await this.emitAuditEvent(
      conversationId,
      'memory.compaction.started',
      audit,
    );

    let summary: StructuredMemorySummary;
    let promptVersion: string | undefined;
    try {
      const previousSummary = existingSummary
        ? this.tryParseSummary(existingSummary)
        : null;
      // cd 调用LLM压缩对话历史
      const summaryMessages = [
        new SystemMessage(shortTermSummaryCompactionSystemPrompt),
        {
          role: 'user' as const,
          content: `旧摘要：${existingSummary ? this.formatSummary(existingSummary, SUMMARY_RECOVERY_PREVIOUS_TOKEN_BUDGET) : '无'}\n\n待压缩对话：\n${trimmedContent}`,
        },
      ];
      await this.assertPromptWithinBudget(summaryMessages, '会话摘要压缩');
      promptVersion = getPromptVersion('memory.summary_compaction');
      const raw = await this.llmProvider.invoke(summaryMessages);
      const compactedIds = new Set([
        ...(previousSummary?.compactedMessageIds ?? []),
        ...toTrim.flatMap((rawTurn) => {
          const turn = JSON.parse(rawTurn) as StoredTurn;
          return turn.messageId ? [turn.messageId] : [];
        }),
      ]);
      const watermark = await this.advanceCompactedPrefix(
        conversationId,
        previousSummary?.compactedThroughMessageId,
        compactedIds,
      );
      summary = {
        ...this.parseStructuredSummary(raw),
        ...(watermark.compactedThroughMessageId
          ? { compactedThroughMessageId: watermark.compactedThroughMessageId }
          : {}),
        compactedMessageIds: watermark.compactedMessageIds,
      };
    } catch (err) {
      this.logger.warn(
        `Short-term memory summarization failed: ${(err as Error).message}`,
      );
      const failed = {
        ...audit,
        status: 'failed' as const,
        ...(promptVersion ? { promptVersion } : {}),
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date().toISOString(),
      };
      await this.saveAudit(conversationId, failed);
      await this.emitAuditEvent(
        conversationId,
        'memory.compaction.failed',
        failed,
      );
      return failed;
    }

    try {
      // 先落 PostgreSQL，再更新 Redis；删除本次压缩的原始项时按 member 精确删，
      // 避免压缩期间新写入的消息被按排名误删。
      await this.persistSummary(conversationId, summary);
      await this.redis.setRequiredOrThrow(
        this.summaryKey(conversationId),
        JSON.stringify(summary),
        TTL_SECONDS,
      );
      await this.redis.zremRequired(key, ...toTrim);
    } catch (error) {
      const failed = {
        ...audit,
        status: 'failed' as const,
        ...(promptVersion ? { promptVersion } : {}),
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      };
      await this.saveAudit(conversationId, failed);
      await this.emitAuditEvent(
        conversationId,
        'memory.compaction.failed',
        failed,
      );
      throw error;
    }

    const completed = {
      ...audit,
      status: 'completed' as const,
      summaryMode: 'llm' as const,
      ...(promptVersion ? { promptVersion } : {}),
      completedAt: new Date().toISOString(),
    };
    await this.saveAudit(conversationId, completed);
    await this.emitAuditEvent(
      conversationId,
      'memory.compaction.completed',
      completed,
    );

    this.logger.debug(
      `Short-term memory compressed: strategy=${selection.strategy}, removed ${toTrim.length} turns, kept ${retainedCount}`,
    );
    return completed;
  }

  protected async resolvePersistentSummary(
    conversationId: string,
  ): Promise<string | null> {
    const existing = await this.getPersistentSummary(conversationId);
    if (existing) return existing;

    const inFlight = this.summaryRecoveryInFlight.get(conversationId);
    if (inFlight) return inFlight;

    const recovery = this.rebuildPersistentSummary(conversationId);
    this.summaryRecoveryInFlight.set(conversationId, recovery);
    try {
      return await recovery;
    } finally {
      if (this.summaryRecoveryInFlight.get(conversationId) === recovery) {
        this.summaryRecoveryInFlight.delete(conversationId);
      }
    }
  }

  protected async rebuildPersistentSummary(
    conversationId: string,
  ): Promise<string | null> {
    let summary: StructuredMemorySummary | null = null;
    let compactedThroughMessageId: string | undefined;
    let sourceParts: string[] = [];
    let sourceTokens = 0;
    const promptVersions = new Set<string>();

    try {
      const messageCount = await this.messageRepo.count({
        where: { conversationId },
      });
      const historicalMessageCount =
        messageCount - SUMMARY_RECOVERY_RECENT_MESSAGE_COUNT;
      if (historicalMessageCount <= 0) return null;

      // 分页读取旧会话，控制单次数据库查询的行数和内存占用。
      for (
        let offset = 0;
        offset < historicalMessageCount;
        offset += SUMMARY_RECOVERY_PAGE_SIZE
      ) {
        const messages = await this.messageRepo
          .createQueryBuilder('message')
          .select([
            'message.role',
            'message.content',
            'message.createdAt',
            'message.id',
          ])
          .where('message.conversationId = :conversationId', {
            conversationId,
          })
          .orderBy('message.createdAt', 'ASC')
          .addOrderBy(
            "CASE WHEN message.role = 'human' THEN 0 WHEN message.role = 'ai' THEN 1 ELSE 2 END",
            'ASC',
          )
          .addOrderBy('message.id', 'ASC')
          .skip(offset)
          .take(
            Math.min(
              SUMMARY_RECOVERY_PAGE_SIZE,
              historicalMessageCount - offset,
            ),
          )
          .getMany();

        for (const message of messages) {
          compactedThroughMessageId = message.id;
          const role = message.role === 'ai' ? 'assistant' : 'user';
          for (const part of this.splitRecoveryMessage(
            this.messageContent(message.content ?? ''),
          )) {
            const sourceLine = `${role}: ${part}`;
            const partTokens = this.estimateTokens(sourceLine) + 4;
            if (
              sourceParts.length > 0 &&
              sourceTokens + partTokens > SUMMARY_RECOVERY_CHUNK_TOKEN_BUDGET
            ) {
              summary = await this.summarizeRecoveryChunk(
                summary,
                sourceParts.join('\n'),
                promptVersions,
              );
              sourceParts = [];
              sourceTokens = 0;
            }
            sourceParts.push(sourceLine);
            sourceTokens += partTokens;
          }
        }
      }

      if (sourceParts.length > 0) {
        summary = await this.summarizeRecoveryChunk(
          summary,
          sourceParts.join('\n'),
          promptVersions,
        );
      }
      if (!summary) return null;
      if (compactedThroughMessageId) {
        summary = { ...summary, compactedThroughMessageId };
      }
    } catch (error) {
      this.logger.warn(
        `Persistent summary recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.emitSummaryRecoveryAudit(
        conversationId,
        'failed',
        promptVersions,
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      // 恢复失败时不保存兜底文本；下次读取仍可重试，原始消息继续保留在 PostgreSQL。
      return null;
    }

    const rawSummary = JSON.stringify(summary);
    try {
      const result = await this.conversationRepo.update(
        { id: conversationId, contextSummary: IsNull() },
        {
          contextSummary: rawSummary,
          contextSummaryVersion: summary.schemaVersion,
          contextSummaryUpdatedAt: new Date(),
        },
      );
      if ((result.affected ?? 0) > 0) {
        await this.emitSummaryRecoveryAudit(
          conversationId,
          'completed',
          promptVersions,
          {
            persistedByThisRequest: true,
          },
        );
        return rawSummary;
      }
      // 多实例同时恢复时，只允许首个结果写入；后完成的任务读取赢家，避免覆盖新摘要。
      const winner = (await this.getPersistentSummary(conversationId)) || null;
      await this.emitSummaryRecoveryAudit(
        conversationId,
        'completed',
        promptVersions,
        {
          persistedByThisRequest: false,
        },
      );
      return winner;
    } catch (error) {
      this.logger.warn(
        `Persistent summary recovery could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.emitSummaryRecoveryAudit(
        conversationId,
        'failed',
        promptVersions,
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return null;
    }
  }

  protected async summarizeRecoveryChunk(
    previous: StructuredMemorySummary | null,
    source: string,
    promptVersions: Set<string>,
  ): Promise<StructuredMemorySummary> {
    const previousSummary = previous
      ? this.formatSummary(
          JSON.stringify(previous),
          SUMMARY_RECOVERY_PREVIOUS_TOKEN_BUDGET,
        )
      : '无';
    const summaryMessages = [
      new SystemMessage(shortTermSummaryRecoverySystemPrompt),
      {
        role: 'user' as const,
        content: `此前摘要：\n${previousSummary}\n\n本批早期对话：\n${source}`,
      },
    ];
    await this.assertPromptWithinBudget(summaryMessages, '会话摘要恢复');
    promptVersions.add(getPromptVersion('memory.summary_recovery'));
    const raw = await this.llmProvider.invoke(summaryMessages);
    return this.parseStructuredSummary(raw);
  }

  protected async emitSummaryRecoveryAudit(
    conversationId: string,
    status: 'completed' | 'failed',
    promptVersions: Set<string>,
    details: Record<string, unknown>,
  ): Promise<void> {
    if (promptVersions.size === 0) return;
    try {
      await this.runtimeEvents?.emit({
        threadId: conversationId,
        eventType: `memory.summary.recovery.${status}`,
        actor: 'short_term_memory',
        payload: {
          promptVersions: [...promptVersions],
          ...details,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Short-term memory recovery audit event failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  protected async assertPromptWithinBudget(
    messages: Array<{ content: unknown }>,
    operation: string,
  ): Promise<void> {
    const promptText = messages
      .map(({ content }) =>
        typeof content === 'string' ? content : JSON.stringify(content),
      )
      .join('\n');
    const estimatedInputTokens =
      (await countTextTokens(promptText)) + messages.length * 4;
    const maxInputTokens = this.getMaxInputTokens();
    if (estimatedInputTokens > maxInputTokens) {
      throw new Error(
        `${operation}固定指令与原始输入超过模型输入预算：${estimatedInputTokens}/${maxInputTokens} tokens`,
      );
    }
  }

  protected getMaxInputTokens(): number {
    const configuredWindow = Number(
      this.config?.get<number>('llm.contextWindowTokens'),
    );
    const contextWindow =
      Number.isFinite(configuredWindow) && configuredWindow > 0
        ? configuredWindow
        : 32_768;
    const activeProvider = this.llmProvider.getActiveProviderName();
    const providers = [
      activeProvider,
      this.llmProvider.getRoutePolicy('fast', activeProvider).fallback,
    ].filter((provider): provider is NonNullable<typeof provider> =>
      Boolean(provider),
    );
    const outputBudget = Math.max(
      4_096,
      ...providers.map((provider) => {
        const configuredOutput = Number(
          this.config?.get<number>(`llm.${provider}.maxTokens`),
        );
        return Math.max(
          Number.isFinite(configuredOutput) && configuredOutput > 0
            ? configuredOutput
            : 4_096,
          this.llmProvider.getRoutePolicy('fast', provider).maxTokens,
        );
      }),
    );
    const safetyMargin = Math.max(256, Math.ceil(contextWindow * 0.1));
    return Math.max(1, contextWindow - outputBudget - safetyMargin);
  }

  protected *splitRecoveryMessage(content: string): Generator<string> {
    if (!content) return;
    let offset = 0;
    while (offset < content.length) {
      let end = Math.min(
        offset + SUMMARY_RECOVERY_MESSAGE_PART_CHARACTERS,
        content.length,
      );
      // 不在 UTF-16 代理对中间切开字符。
      const lastCharacter = content.charCodeAt(end - 1);
      const nextCharacter = content.charCodeAt(end);
      if (
        end < content.length &&
        lastCharacter >= 0xd800 &&
        lastCharacter <= 0xdbff &&
        nextCharacter >= 0xdc00 &&
        nextCharacter <= 0xdfff
      ) {
        end -= 1;
      }
      yield content.slice(offset, end);
      offset = end;
    }
  }

  protected toSummarySystemMessage(
    summary: string,
    tokenBudget: number,
  ): SystemMessage | null {
    const formattedSummary = this.formatSummary(summary, tokenBudget);
    return formattedSummary
      ? new SystemMessage(`【历史对话结构化变更摘要】\n${formattedSummary}`)
      : null;
  }

  protected selectCompactionMessages(
    turns: StoredTurn[],
    maxRetained: number,
    targetTokens: number,
  ): {
    removeIndexes: number[];
    baseStrategy: CompactionStrategy;
    strategy: RemovalStrategy;
    confidence: number;
    adaptiveComparison?: Record<string, number>;
  } {
    const tokens = turns.map(
      (turn) => this.estimateTokens(`${turn.role}: ${turn.content}`) + 4,
    );
    const totalTokens = tokens.reduce((total, value) => total + value, 0);
    const baseStrategy = this.getBaseCompactionStrategy();
    let strategy: RemovalStrategy;
    let confidence = 1;
    let adaptiveComparison: Record<string, number> | undefined;

    if (baseStrategy === 'hybrid') {
      const recommendation = this.recommendRemovalStrategy(
        turns,
        tokens,
        totalTokens,
        targetTokens,
      );
      confidence = recommendation.confidence;
      if (confidence >= COMPACTION_STRATEGY_CONFIDENCE_THRESHOLD) {
        strategy = recommendation.strategy;
      } else {
        const middle = this.runRemovalStrategy(
          turns,
          tokens,
          maxRetained,
          targetTokens,
          'middle-removal',
        );
        const oldest = this.runRemovalStrategy(
          turns,
          tokens,
          maxRetained,
          targetTokens,
          'oldest-removal',
        );
        const middleScore = this.removalEfficiencyScore(
          middle,
          totalTokens,
          turns.length,
        );
        const oldestScore = this.removalEfficiencyScore(
          oldest,
          totalTokens,
          turns.length,
        );
        strategy =
          middleScore >= oldestScore ? 'middle-removal' : 'oldest-removal';
        adaptiveComparison = {
          middleRemoval: middleScore,
          oldestRemoval: oldestScore,
        };
      }
    } else {
      strategy = baseStrategy;
    }

    const selected = this.runRemovalStrategy(
      turns,
      tokens,
      maxRetained,
      targetTokens,
      strategy,
    );
    return {
      removeIndexes: [...selected.removeIndexes].sort(
        (left, right) => left - right,
      ),
      baseStrategy,
      strategy,
      confidence,
      ...(adaptiveComparison ? { adaptiveComparison } : {}),
    };
  }

  protected getBaseCompactionStrategy(): CompactionStrategy {
    const provider = this.llmProvider.getActiveProviderName().toLowerCase();
    const model =
      this.config?.get<string>(`llm.${provider}.model`)?.toLowerCase() ?? '';
    if (provider === 'openai')
      return /\bo1(?:-|$)/.test(model) ? 'middle-removal' : 'hybrid';
    if (provider === 'anthropic') return 'oldest-removal';
    if (provider === 'google' && /1\.5/.test(model)) return 'middle-removal';
    if (['lmstudio', 'ollama', 'local'].includes(provider)) return 'hybrid';
    // 参考文档未给 Qwen、DeepSeek、GLM 等模型的映射，沿用项目原有的最旧优先策略。
    return 'oldest-removal';
  }

  protected recommendRemovalStrategy(
    turns: StoredTurn[],
    tokens: number[],
    totalTokens: number,
    targetTokens: number,
  ): { strategy: RemovalStrategy; confidence: number } {
    const compressionRatio = totalTokens > 0 ? targetTokens / totalTokens : 1;
    const severity =
      compressionRatio > 0.8
        ? 'light'
        : compressionRatio > 0.6
          ? 'moderate'
          : 'heavy';
    const recentTokens = tokens
      .slice(-5)
      .reduce((total, value) => total + value, 0);
    const recentRatio = totalTokens > 0 ? recentTokens / totalTokens : 0;
    const hasLongMessages = tokens.some((value) => value > 300);
    const hasSystemMessages = turns.some((turn) => turn.role === 'system');

    if (severity === 'light' && turns.length < 20) {
      return { strategy: 'middle-removal', confidence: 0.8 };
    }
    if (severity === 'heavy' && turns.length > 30) {
      return { strategy: 'oldest-removal', confidence: 0.9 };
    }
    if (recentRatio > 0.4) {
      return { strategy: 'middle-removal', confidence: 0.7 };
    }
    if (hasLongMessages && severity !== 'light') {
      return { strategy: 'oldest-removal', confidence: 0.6 };
    }
    if (hasSystemMessages) {
      return { strategy: 'middle-removal', confidence: 0.7 };
    }
    return { strategy: 'oldest-removal', confidence: 0.5 };
  }

  protected runRemovalStrategy(
    turns: StoredTurn[],
    tokens: number[],
    maxRetained: number,
    targetTokens: number,
    strategy: RemovalStrategy,
  ): {
    removeIndexes: Set<number>;
    remainingTokens: number;
    retainedCount: number;
  } {
    const removable = turns
      .map((turn, index) => ({ turn, index }))
      .filter(({ turn }) => turn.role !== 'system');
    const priorities = turns.map((turn, index) =>
      this.messagePriority(turn, index, turns.length, tokens[index]),
    );
    const byPriorityThenAge = (left: number, right: number) =>
      priorities[left] - priorities[right] || left - right;
    let candidates: number[];

    if (strategy === 'oldest-removal') {
      candidates = removable.map(({ index }) => index).sort(byPriorityThenAge);
    } else {
      const preserveStart = Math.min(2, Math.ceil(turns.length * 0.2));
      const preserveEnd = Math.min(
        4,
        Math.max(2, Math.ceil(turns.length * 0.3)),
      );
      const middleEnd = Math.max(preserveStart, turns.length - preserveEnd);
      const middle = removable
        .map(({ index }) => index)
        .filter((index) => index >= preserveStart && index < middleEnd)
        .sort(
          (left, right) =>
            priorities[left] - priorities[right] ||
            Math.abs(left + 0.5 - turns.length / 2) -
              Math.abs(right + 0.5 - turns.length / 2),
        );
      const edges = removable
        .map(({ index }) => index)
        .filter((index) => index < preserveStart || index >= middleEnd)
        .sort(byPriorityThenAge);
      candidates = [...middle, ...edges];
    }

    const removeIndexes = new Set<number>();
    let remainingTokens = tokens.reduce((total, value) => total + value, 0);
    let retainedCount = turns.length;
    for (const index of candidates) {
      if (remainingTokens <= targetTokens && retainedCount <= maxRetained)
        break;
      removeIndexes.add(index);
      remainingTokens -= tokens[index];
      retainedCount -= 1;
    }
    return { removeIndexes, remainingTokens, retainedCount };
  }

  protected messagePriority(
    turn: StoredTurn,
    index: number,
    total: number,
    tokens: number,
  ): number {
    if (turn.role === 'system') return 4;
    if (index < 2 || index >= total - 2 || tokens > 800) return 3;
    if (tokens < 20 && !/[?？]/.test(turn.content)) return 0;
    return 1;
  }

  protected removalEfficiencyScore(
    result: { remainingTokens: number; retainedCount: number },
    originalTokens: number,
    originalCount: number,
  ): number {
    const tokenReduction =
      originalTokens > 0
        ? (originalTokens - result.remainingTokens) / originalTokens
        : 0;
    const messagePreservation =
      originalCount > 0 ? result.retainedCount / originalCount : 1;
    return tokenReduction * 0.6 + messagePreservation * 0.4;
  }

  protected selectRecentTurns(
    turns: StoredTurn[],
    maxMessages: number,
    tokenBudget: number,
  ): StoredTurn[] {
    return this.limitHistoryToTokenBudget(turns, tokenBudget, maxMessages);
  }

  protected estimateStoredTurnTokens(rawTurns: string[]): number {
    return rawTurns.reduce((total, raw) => {
      try {
        const turn = JSON.parse(raw) as StoredTurn;
        return total + this.estimateTokens(`${turn.role}: ${turn.content}`) + 4;
      } catch {
        return total + this.estimateTokens(raw);
      }
    }, 0);
  }

  protected estimateTokens(text: string): number {
    const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    return Math.ceil(cjk * 0.75 + Math.max(text.length - cjk, 0) / 4);
  }

  protected parseStructuredSummary(raw: string): StructuredMemorySummary {
    const candidate = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
    return this.normalizeSummary(
      structuredMemorySummarySchema.parse(JSON.parse(candidate)),
    );
  }

  protected tryParseSummary(raw: string): StructuredMemorySummary | null {
    try {
      return this.normalizeSummary(
        structuredMemorySummarySchema.parse(JSON.parse(raw)),
      );
    } catch {
      return null;
    }
  }

  protected normalizeSummary(
    summary: StructuredMemorySummary,
  ): StructuredMemorySummary {
    const boundedText = (value: string, limit: number) =>
      value.trim().slice(0, limit);
    const boundedList = (values: string[]) =>
      [
        ...new Set(
          values
            .map((value) => boundedText(value, SUMMARY_MAX_ITEM_CHARACTERS))
            .filter(Boolean),
        ),
      ].slice(-SUMMARY_MAX_LIST_ITEMS);

    return {
      ...summary,
      currentGoal: boundedText(
        summary.currentGoal,
        SUMMARY_MAX_GOAL_CHARACTERS,
      ),
      constraints: boundedList(summary.constraints),
      nextActions: boundedList(summary.nextActions),
      changes: summary.changes.slice(-8).map((change) => ({
        role: boundedText(change.role, 40),
        module: boundedText(change.module, 60),
        before: boundedText(change.before, 120),
        after: boundedText(change.after, 120),
        version: boundedText(change.version, 40),
        effectiveFrom: boundedText(change.effectiveFrom, 40),
        evidence: boundedText(change.evidence, 120),
      })),
      decisions: boundedList(summary.decisions),
      openIssues: boundedList(summary.openIssues),
      sourceDigest: boundedText(
        summary.sourceDigest,
        SUMMARY_MAX_DIGEST_CHARACTERS,
      ),
      ...(summary.compactedMessageIds
        ? { compactedMessageIds: [...new Set(summary.compactedMessageIds)] }
        : {}),
    };
  }

  protected formatSummary(raw: string, tokenBudget = 1_500): string {
    const summary = this.tryParseSummary(raw);
    if (!summary) return this.truncateToTokenBudget(raw, tokenBudget);
    const candidates = [
      summary.currentGoal ? `- 当前目标：${summary.currentGoal}` : '',
      ...summary.constraints.map((item) => `- 仍有效的约束：${item}`),
      ...summary.nextActions.map((item) => `- 下一步：${item}`),
      ...summary.changes.map(
        (item) =>
          `- [${item.role}/${item.module}/${item.version}] ${item.before} → ${item.after}；生效：${item.effectiveFrom}；证据：${item.evidence}`,
      ),
      ...summary.decisions.map((item) => `- 决策：${item}`),
      ...summary.openIssues.map((item) => `- 待确认：${item}`),
      summary.sourceDigest ? `- 摘要：${summary.sourceDigest}` : '',
    ].filter(Boolean);
    const lines: string[] = [];
    let usedTokens = 0;
    for (const candidate of candidates) {
      const lineTokens = this.estimateTokens(candidate) + 1;
      if (usedTokens + lineTokens > tokenBudget) continue;
      lines.push(candidate);
      usedTokens += lineTokens;
    }
    return lines.join('\n');
  }

  protected truncateToTokenBudget(text: string, tokenBudget: number): string {
    if (tokenBudget <= 0) return '';
    if (this.estimateTokens(text) <= tokenBudget) return text;
    let low = 0;
    let high = text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.estimateTokens(text.slice(0, middle)) <= tokenBudget) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return text.slice(0, low);
  }
}
