import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { InjectRepository } from '@nestjs/typeorm';
import { z } from 'zod';
import { Repository } from 'typeorm';
import {
  Mem0Provider,
  type Mem0MemoryResult,
} from '../../providers/mem0/mem0.provider';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { ConversationEntity } from '../../providers/db/entities/conversation.entity';
import { MessageEntity } from '../../providers/db/entities/message.entity';
import { DomainEventOutboxEntity } from '../../providers/db/entities/domain-event-outbox.entity';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';
import { countTextTokens } from '../document/chunking.util';
import {
  getPromptMetadata,
  getPromptVersion,
} from '../../rag/prompts/prompt-registry';
import { memoryClassifierSystemPrompt } from './memory.prompts';
import { MemoryConsolidationService } from './memory-consolidation.service';
import {
  buildMemorySystemMessage,
  extractExplicitUserMemoryExpiration,
  formatMemoryContextBlocks,
  isExpiredUserMemory,
  isSupersededUserMemory,
  isUserScopedMemory,
  type MemoryContextBlock,
} from './memory-context.support';

export type { MemoryContextBlock } from './memory-context.support';

const CONVERSATION_MEMORY_PERSIST_EVENT = 'conversation.memory.persist';
const MESSAGE_META_PREFIX = '<!-- rag-message-meta:';
const MESSAGE_META_SUFFIX = ' -->';

/** 分类器输出 schema */
const memoryClassifierSchema = z.object({
  write_user: z
    .boolean()
    .describe(
      '写入用户层：换一个新会话仍应保留的长期事实（身份、居住地、长期爱好、饮食禁忌、持久偏好）。不含仅本轮任务。',
    ),
  write_session: z
    .boolean()
    .describe(
      '写入会话层：仅当前会话/thread 有效的任务、大纲、进度、待办、临时决策（如「这次先写…」「数据部分明天补」）。',
    ),
  user_expiration_applies_to_all: z
    .boolean()
    .optional()
    .describe(
      '仅当本轮所有要写入 user 层的事实都有同一个、由用户明确说出的绝对到期日期时为 true；否则为 false。',
    ),
  superseded_memory_ids: z
    .array(z.string().min(1))
    .default([])
    .describe(
      '只列出被用户本轮明确更正或替换、且来自当前长期记忆候选列表的记忆 ID。没有明确更正时返回空数组。',
    ),
  reason: z.string().describe('分类理由，一句话'),
});

type MemoryClassifierOutput = z.infer<typeof memoryClassifierSchema>;

interface MemoryPersistenceProgress {
  classification?: Pick<
    MemoryClassifierOutput,
    | 'write_user'
    | 'write_session'
    | 'user_expiration_applies_to_all'
    | 'superseded_memory_ids'
  >;
  promptVersion?: string;
  completedScopes?: Array<'user' | 'session'>;
  completedSupersededMemoryIds?: string[];
  supersededMemoryCandidates?: Array<{
    id: string;
    metadata?: Record<string, unknown>;
  }>;
  sourceMessageIds?: string[];
  sourceRecordedAt?: string;
  sourceEventId?: string;
  onProgress?: (progress: {
    classification: Pick<
      MemoryClassifierOutput,
      | 'write_user'
      | 'write_session'
      | 'user_expiration_applies_to_all'
      | 'superseded_memory_ids'
    >;
    promptVersion?: string;
    completedScopes: Array<'user' | 'session'>;
    completedSupersededMemoryIds: string[];
    supersededMemoryCandidates: Array<{
      id: string;
      metadata?: Record<string, unknown>;
    }>;
  }) => void;
}

export interface MemorySearchResult {
  userMemories: Mem0MemoryResult[];
  sessionMemories: Mem0MemoryResult[];
  systemMessage: SystemMessage | null;
}

export interface MemoryClassifyResult {
  written: string[];
  reason: string;
  failed?: string[];
  promptVersion?: string;
}

@Injectable()
export class MemoryService {
  /**
   * 记忆分层门面：user 层用于跨会话长期事实，session 层仅保存当前 Thread 的临时上下文。
   * 写入始终由分类器决定，不能因前端展示或一次性请求直接写入长期记忆。
   */
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly mem0Provider: Mem0Provider,
    private readonly llmProvider: LlmProvider,
    @Optional()
    @InjectRepository(ConversationEntity)
    private readonly conversationRepository?: Repository<ConversationEntity>,
    @Optional()
    @InjectRepository(MessageEntity)
    private readonly messageRepository?: Repository<MessageEntity>,
    @Optional() private readonly domainEvents?: DomainEventsService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly runtimeEvents?: AgentRuntimeEventsService,
    @Optional()
    private readonly consolidationService?: MemoryConsolidationService,
  ) {
    this.domainEvents?.registerInternalHandler(
      CONVERSATION_MEMORY_PERSIST_EVENT,
      (event) =>
        this.llmProvider.runWithRequestBudget(() =>
          this.persistOutboxMemory(event),
        ),
    );
  }

  isEnabled(): boolean {
    return this.mem0Provider.isEnabled();
  }

  getStatus(): {
    enabled: boolean;
    scopes: Array<'user' | 'session'>;
    writePolicy: string;
  } {
    return {
      enabled: this.mem0Provider.isEnabled(),
      scopes: ['user', 'session'],
      writePolicy:
        'LLM classifier writes durable user facts and temporary session context; explicit user corrections supersede older user memories.',
    };
  }

  /**
   * 搜索用户 + 会话层记忆，构建 SystemMessage
   *
   * 在 chat 前调用，将记忆注入到 LLM 上下文中
   */
  async searchMemory(
    query: string,
    userId: string,
    conversationId?: string,
    topK = 5,
  ): Promise<MemorySearchResult> {
    if (!this.mem0Provider.isEnabled()) {
      return { userMemories: [], sessionMemories: [], systemMessage: null };
    }

    // 并行搜索 user 层和 session 层
    const userCandidateLimit = Math.min(Math.max(topK, 1) * 5, 100);
    const [userCandidates, sessionMemories] = await Promise.all([
      this.mem0Provider.search({
        query,
        userId,
        topK: userCandidateLimit,
      }),
      conversationId
        ? this.mem0Provider.search({
            query,
            userId,
            runId: conversationId,
            topK,
          })
        : Promise.resolve<Mem0MemoryResult[]>([]),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const approvedSummaries = userCandidates.filter(
      (memory) =>
        memory.metadata?.rag_memory_kind === 'consolidation' &&
        memory.metadata?.rag_consolidation_status === 'approved' &&
        !isExpiredUserMemory(memory, today) &&
        !isSupersededUserMemory(memory),
    );
    const consolidatedSourceIds = new Set(
      approvedSummaries.flatMap((summary) => {
        const sources = summary.metadata?.rag_consolidation_sources;
        return Array.isArray(sources)
          ? sources.flatMap((source) =>
              source &&
              typeof source === 'object' &&
              typeof (source as Record<string, unknown>).id === 'string'
                ? [(source as Record<string, unknown>).id as string]
                : [],
            )
          : [];
      }),
    );
    const userMemories = userCandidates
      .filter((memory) => {
        const isConsolidation =
          memory.metadata?.rag_memory_kind === 'consolidation';
        return (
          isUserScopedMemory(memory) &&
          !isExpiredUserMemory(memory, today) &&
          !isSupersededUserMemory(memory) &&
          (!isConsolidation ||
            memory.metadata?.rag_consolidation_status === 'approved') &&
          (isConsolidation || !consolidatedSourceIds.has(memory.id))
        );
      })
      .slice(0, Math.max(0, topK));

    const systemMessage = buildMemorySystemMessage(
      userMemories,
      sessionMemories,
    );

    if (userMemories.length) {
      this.logger.debug(`Mem0 user memories: ${userMemories.length}`);
    }
    if (sessionMemories.length) {
      this.logger.debug(`Mem0 session memories: ${sessionMemories.length}`);
    }

    return { userMemories, sessionMemories, systemMessage };
  }

  /** Returns budgetable blocks using the same labels and trust guard as systemMessage. */
  static formatContextBlocks(
    userMemories: Mem0MemoryResult[],
    sessionMemories: Mem0MemoryResult[],
  ): MemoryContextBlock[] {
    return formatMemoryContextBlocks(userMemories, sessionMemories);
  }

  /**
   * 分类并持久化本轮对话到 Mem0
   *
   * 在 chat 后调用，由 LLM 分类器判断是否写入
   */
  /**
   * 在回答完成后异步判断本轮是否包含新事实，再分别写入 user／session 两层。
   * 分类失败宁可不写入，也不能把未经判断的对话永久化。
   */
  async classifyAndPersist(
    userId: string,
    conversationId: string | undefined,
    userText: string,
    assistantText: string,
    progress: MemoryPersistenceProgress = {},
  ): Promise<MemoryClassifyResult> {
    if (!this.mem0Provider.isEnabled()) {
      return { written: [], reason: 'mem0 disabled' };
    }

    let result: MemoryClassifierOutput;
    let existingUserMemories: Mem0MemoryResult[] = [];
    let supersededMemoryCandidates = progress.supersededMemoryCandidates ?? [];
    let promptVersion = progress.promptVersion;
    const classificationSource = progress.classification
      ? 'resumed_outbox'
      : 'llm';
    if (progress.classification) {
      result = {
        ...progress.classification,
        superseded_memory_ids:
          progress.classification.superseded_memory_ids ?? [],
        reason: 'resumed from persisted outbox classification',
      };
    } else {
      try {
        existingUserMemories = (
          (await this.mem0Provider.search({
            query: userText,
            userId,
            topK: 10,
          })) ?? []
        ).filter(
          (memory) =>
            !isSupersededUserMemory(memory) &&
            !isExpiredUserMemory(memory, new Date().toISOString().slice(0, 10)),
        );
        const userMemoryCandidates = existingUserMemories.map((memory) => ({
          id: memory.id,
          memory: memory.memory.slice(0, 500),
          recordedAt:
            typeof memory.metadata?.rag_recorded_at === 'string'
              ? memory.metadata.rag_recorded_at
              : null,
        }));
        const classifierMessages = [
          new SystemMessage(memoryClassifierSystemPrompt),
          new HumanMessage(
            [
              `用户：${userText}`,
              `助手：${assistantText}`,
              '当前长期记忆候选（仅用于判断是否有被用户明确更正的旧事实）：',
              JSON.stringify(userMemoryCandidates),
            ].join('\n'),
          ),
        ];
        const estimatedInputTokens =
          await this.estimatePromptTokens(classifierMessages);
        const maxInputTokens = this.getMaxInputTokens();
        if (estimatedInputTokens > maxInputTokens) {
          const reason = `memory classification skipped: protected prompt exceeds input budget (${estimatedInputTokens}/${maxInputTokens} tokens)`;
          this.logger.warn(reason);
          return { written: [], reason };
        }
        const classifier = this.llmProvider
          .getModel()
          .withStructuredOutput(memoryClassifierSchema);
        promptVersion = getPromptVersion('memory.classifier');
        const classification = await classifier.invoke(classifierMessages, {
          metadata: getPromptMetadata('memory.classifier'),
        });
        result = {
          ...classification,
          superseded_memory_ids: classification.superseded_memory_ids ?? [],
        };
        const candidateIds = new Set(
          existingUserMemories.map((memory) => memory.id),
        );
        result.superseded_memory_ids = [
          ...new Set(result.superseded_memory_ids ?? []),
        ].filter((id) => candidateIds.has(id));
        supersededMemoryCandidates = existingUserMemories
          .filter((memory) => result.superseded_memory_ids.includes(memory.id))
          .map(({ id, metadata }) => ({
            id,
            ...(metadata ? { metadata } : {}),
          }));
      } catch (err) {
        const message = (err as Error).message;
        this.logger.error(
          `Memory classify failed before persistence: ${message}`,
        );
        if (conversationId) {
          try {
            await this.runtimeEvents?.emit({
              threadId: conversationId,
              eventType: 'memory.classification.failed',
              actor: 'memory',
              payload: {
                source: 'llm',
                ...(promptVersion ? { promptVersion } : {}),
              },
            });
          } catch (auditError) {
            this.logger.warn(
              `Memory classification failure audit event failed: ${(auditError as Error).message}`,
            );
          }
        }
        return {
          written: [],
          failed: ['classification'],
          reason: `error: ${message}`,
          ...(promptVersion ? { promptVersion } : {}),
        };
      }
    }

    const written: string[] = [];
    const failed: string[] = [];
    const completedScopes = new Set(progress.completedScopes ?? []);
    const completedSupersededMemoryIds = new Set(
      progress.completedSupersededMemoryIds ?? [],
    );
    const saveProgress = () => {
      progress.onProgress?.({
        classification: {
          write_user: result.write_user,
          write_session: result.write_session,
          ...(result.user_expiration_applies_to_all === undefined
            ? {}
            : {
                user_expiration_applies_to_all:
                  result.user_expiration_applies_to_all,
              }),
          superseded_memory_ids: result.superseded_memory_ids ?? [],
        },
        ...(promptVersion ? { promptVersion } : {}),
        completedScopes: [...completedScopes],
        completedSupersededMemoryIds: [...completedSupersededMemoryIds],
        supersededMemoryCandidates,
      });
    };
    saveProgress();
    const turn: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: userText },
      { role: 'assistant', content: assistantText },
    ];
    const sourceRecordedAt =
      progress.sourceRecordedAt ?? new Date().toISOString();
    const sourceUserMessageId = progress.sourceMessageIds?.[0];
    const wasPersistedBeforeOutboxCheckpoint = async (
      scope: 'user' | 'session',
    ): Promise<boolean> => {
      if (!progress.sourceEventId) return false;
      const priorMemories = await this.mem0Provider.getAll(
        userId,
        scope === 'session' ? conversationId : undefined,
        false,
        true,
      );
      return priorMemories.some(
        (memory) =>
          memory.metadata?.rag_source_event_id === progress.sourceEventId &&
          memory.metadata?.rag_memory_scope === scope &&
          memory.metadata?.rag_source_conversation_id === conversationId,
      );
    };

    if (result.write_user) {
      if (completedScopes.has('user')) {
        written.push('user');
      } else {
        try {
          const alreadyPersisted =
            await wasPersistedBeforeOutboxCheckpoint('user');
          if (alreadyPersisted) {
            this.logger.warn(
              `Mem0 outbox replay detected existing user memory: eventId=${progress.sourceEventId}`,
            );
          } else {
            const explicitExpiration = result.user_expiration_applies_to_all
              ? extractExplicitUserMemoryExpiration(userText)
              : null;
            await this.mem0Provider.add({
              messages: [{ role: 'user', content: userText }],
              userId,
              metadata: {
                rag_memory_scope: 'user',
                rag_recorded_at: sourceRecordedAt,
                ...(progress.sourceEventId
                  ? { rag_source_event_id: progress.sourceEventId }
                  : {}),
                ...(conversationId
                  ? { rag_source_conversation_id: conversationId }
                  : {}),
                ...(sourceUserMessageId
                  ? {
                      rag_source_role: 'user',
                      rag_source_message_id: sourceUserMessageId,
                      rag_source_message_ids: [sourceUserMessageId],
                    }
                  : {}),
                ...(explicitExpiration
                  ? { rag_valid_until: explicitExpiration }
                  : {}),
              },
            });
          }
          written.push('user');
          completedScopes.add('user');
          saveProgress();
        } catch (err) {
          failed.push('user');
          this.logger.error(
            `Mem0 user-scope persistence failed: ${(err as Error).message}`,
          );
        }
      }

      if (completedScopes.has('user')) {
        if (!written.includes('user')) written.push('user');
        const pendingSupersededIds = (
          result.superseded_memory_ids ?? []
        ).filter((id) => !completedSupersededMemoryIds.has(id));
        if (pendingSupersededIds.length > 0) {
          try {
            const candidatesById = new Map(
              supersededMemoryCandidates.map((memory) => [memory.id, memory]),
            );
            for (const memoryId of pendingSupersededIds) {
              const memory = candidatesById.get(memoryId);
              if (
                !memory ||
                isSupersededUserMemory({
                  id: memory.id,
                  memory: '',
                  metadata: memory.metadata,
                })
              ) {
                completedSupersededMemoryIds.add(memoryId);
                saveProgress();
                continue;
              }

              const previousRecordedAt = memory.metadata?.rag_recorded_at;
              if (
                typeof previousRecordedAt !== 'string' ||
                previousRecordedAt >= sourceRecordedAt
              ) {
                completedSupersededMemoryIds.add(memoryId);
                saveProgress();
                continue;
              }

              await this.mem0Provider.updateMetadata(memoryId, {
                ...(memory.metadata ?? {}),
                rag_superseded_at: sourceRecordedAt,
                ...(sourceUserMessageId
                  ? {
                      rag_superseded_by_source_message_id: sourceUserMessageId,
                    }
                  : {}),
              });
              await this.consolidationService?.invalidateForSupersededSources(
                userId,
                [memoryId],
              );
              completedSupersededMemoryIds.add(memoryId);
              saveProgress();
            }
          } catch (err) {
            failed.push('user_conflict_resolution');
            this.logger.error(
              `Mem0 user-memory conflict resolution failed: ${(err as Error).message}`,
            );
          }
        }
      }
    }

    if (result.write_session && conversationId) {
      if (completedScopes.has('session')) {
        written.push('session');
      } else {
        try {
          const alreadyPersisted =
            await wasPersistedBeforeOutboxCheckpoint('session');
          if (alreadyPersisted) {
            this.logger.warn(
              `Mem0 outbox replay detected existing session memory: eventId=${progress.sourceEventId}`,
            );
          } else {
            await this.mem0Provider.add({
              messages: turn,
              userId,
              runId: conversationId,
              metadata: {
                rag_memory_scope: 'session',
                rag_recorded_at: sourceRecordedAt,
                ...(progress.sourceEventId
                  ? { rag_source_event_id: progress.sourceEventId }
                  : {}),
                rag_source_conversation_id: conversationId,
                ...(sourceUserMessageId
                  ? {
                      rag_source_role: 'user',
                      rag_source_message_id: sourceUserMessageId,
                      rag_source_message_ids: progress.sourceMessageIds ?? [
                        sourceUserMessageId,
                      ],
                    }
                  : {}),
              },
            });
          }
          written.push('session');
          completedScopes.add('session');
          saveProgress();
        } catch (err) {
          failed.push('session');
          this.logger.error(
            `Mem0 session-scope persistence failed: ${(err as Error).message}`,
          );
        }
      }
    }

    this.logger.log(
      `Memory classify: reason="${result.reason}", written=[${written.join(', ')}], failed=[${failed.join(', ')}]`,
    );

    if (conversationId) {
      try {
        await this.runtimeEvents?.emit({
          threadId: conversationId,
          eventType: 'memory.classification.completed',
          actor: 'memory',
          payload: {
            source: classificationSource,
            classification: {
              write_user: result.write_user,
              write_session: result.write_session,
              superseded_memory_ids: result.superseded_memory_ids ?? [],
            },
            written,
            failed,
            ...(promptVersion ? { promptVersion } : {}),
          },
        });
      } catch (error) {
        this.logger.warn(
          `Memory classification audit event failed: ${(error as Error).message}`,
        );
      }
    }

    return {
      written,
      failed,
      reason: result.reason,
      ...(promptVersion ? { promptVersion } : {}),
    };
  }

  private async persistOutboxMemory(
    event: DomainEventOutboxEntity,
  ): Promise<void> {
    if (!this.conversationRepository || !this.messageRepository) {
      throw new Error('Conversation repositories are unavailable.');
    }
    if (!this.mem0Provider.isEnabled()) {
      throw new Error('Mem0 is unavailable while a memory event is pending.');
    }
    if (event.aggregateType !== 'conversation') {
      throw new Error(
        'Conversation memory event has an invalid aggregateType.',
      );
    }

    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(event.payload);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid event payload.');
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      throw new Error('Conversation memory event has an invalid payload.');
    }

    const threadId = event.aggregateId.trim();
    const userId = payload.userId;
    const userMessageId = payload.userMessageId;
    const assistantMessageId = payload.assistantMessageId;
    if (
      !threadId ||
      typeof userId !== 'string' ||
      !userId.trim() ||
      typeof userMessageId !== 'string' ||
      !userMessageId.trim() ||
      typeof assistantMessageId !== 'string' ||
      !assistantMessageId.trim()
    ) {
      throw new Error('Conversation memory event is missing message identity.');
    }

    const conversation = await this.conversationRepository.findOneBy({
      id: threadId,
    });
    // A deleted conversation must not recreate its session memories.
    if (!conversation) return;

    const tenantId = event.tenantId?.trim() || 'legacy';
    if ((conversation.tenantId?.trim() || 'legacy') !== tenantId) {
      throw new Error(
        'Conversation memory event tenant does not match its conversation.',
      );
    }
    if (conversation.userId?.trim() && conversation.userId !== userId) {
      throw new Error(
        'Conversation memory event user does not own its conversation.',
      );
    }

    const [userMessage, assistantMessage] = await Promise.all([
      this.messageRepository.findOneBy({ id: userMessageId }),
      this.messageRepository.findOneBy({ id: assistantMessageId }),
    ]);
    if (!userMessage || !assistantMessage) {
      throw new Error('Conversation memory event references missing messages.');
    }
    for (const message of [userMessage, assistantMessage]) {
      if (
        message.conversationId !== threadId ||
        (message.tenantId?.trim() || 'legacy') !== tenantId
      ) {
        throw new Error(
          'Conversation memory event references a message outside its scope.',
        );
      }
    }
    if (userMessage.role !== 'human' || assistantMessage.role !== 'ai') {
      throw new Error(
        'Conversation memory event references invalid message roles.',
      );
    }

    const completedScopes: Array<'user' | 'session'> = [];
    if (payload.completedMemoryScopes !== undefined) {
      const scopes: unknown = payload.completedMemoryScopes;
      if (!Array.isArray(scopes)) {
        throw new Error(
          'Conversation memory event has invalid completed scopes.',
        );
      }
      for (const scope of scopes as unknown[]) {
        if (scope !== 'user' && scope !== 'session') {
          throw new Error(
            'Conversation memory event has invalid completed scopes.',
          );
        }
        completedScopes.push(scope);
      }
    }

    const completedSupersededMemoryIds: string[] = [];
    if (payload.completedSupersededMemoryIds !== undefined) {
      if (
        !Array.isArray(payload.completedSupersededMemoryIds) ||
        payload.completedSupersededMemoryIds.some(
          (id) => typeof id !== 'string' || !id.trim(),
        )
      ) {
        throw new Error(
          'Conversation memory event has invalid superseded memory IDs.',
        );
      }
      completedSupersededMemoryIds.push(
        ...(payload.completedSupersededMemoryIds as string[]),
      );
    }

    let supersededMemoryCandidates: MemoryPersistenceProgress['supersededMemoryCandidates'];
    if (payload.supersededMemoryCandidates !== undefined) {
      if (!Array.isArray(payload.supersededMemoryCandidates)) {
        throw new Error(
          'Conversation memory event has invalid superseded memory candidates.',
        );
      }
      supersededMemoryCandidates = payload.supersededMemoryCandidates.map(
        (candidate) => {
          if (
            !candidate ||
            typeof candidate !== 'object' ||
            Array.isArray(candidate) ||
            typeof (candidate as Record<string, unknown>).id !== 'string' ||
            !(candidate as Record<string, unknown>).id
          ) {
            throw new Error(
              'Conversation memory event has invalid superseded memory candidates.',
            );
          }
          const metadata = (candidate as Record<string, unknown>).metadata;
          if (
            metadata !== undefined &&
            (!metadata ||
              typeof metadata !== 'object' ||
              Array.isArray(metadata))
          ) {
            throw new Error(
              'Conversation memory event has invalid superseded memory metadata.',
            );
          }
          return {
            id: (candidate as Record<string, unknown>).id as string,
            ...(metadata
              ? { metadata: metadata as Record<string, unknown> }
              : {}),
          };
        },
      );
    }

    let classification: MemoryPersistenceProgress['classification'];
    const promptVersion =
      typeof payload.memoryClassificationPromptVersion === 'string'
        ? payload.memoryClassificationPromptVersion
        : undefined;
    if (payload.memoryClassification !== undefined) {
      const parsedClassification = memoryClassifierSchema
        .pick({
          write_user: true,
          write_session: true,
          user_expiration_applies_to_all: true,
          superseded_memory_ids: true,
        })
        .safeParse(payload.memoryClassification);
      if (!parsedClassification.success) {
        throw new Error(
          'Conversation memory event has an invalid classification.',
        );
      }
      classification = parsedClassification.data;
    }

    const result = await this.classifyAndPersist(
      userId,
      threadId,
      this.decodeStoredMessageContent(userMessage.content),
      this.decodeStoredMessageContent(assistantMessage.content),
      {
        classification,
        promptVersion,
        sourceEventId: event.id,
        completedScopes,
        completedSupersededMemoryIds,
        supersededMemoryCandidates,
        sourceMessageIds: [userMessage.id, assistantMessage.id],
        sourceRecordedAt: userMessage.createdAt.toISOString(),
        onProgress: (progress) => {
          payload.memoryClassification = progress.classification;
          if (progress.promptVersion) {
            payload.memoryClassificationPromptVersion = progress.promptVersion;
          }
          payload.completedMemoryScopes = progress.completedScopes;
          payload.completedSupersededMemoryIds =
            progress.completedSupersededMemoryIds;
          payload.supersededMemoryCandidates =
            progress.supersededMemoryCandidates;
          event.payload = JSON.stringify(payload);
        },
      },
    );
    if (result.failed?.length) {
      throw new Error(
        `Conversation memory event was not fully persisted: ${result.failed.join(', ')}`,
      );
    }
  }

  private decodeStoredMessageContent(content: string): string {
    const markerStart = content.lastIndexOf(MESSAGE_META_PREFIX);
    if (markerStart < 0 || !content.endsWith(MESSAGE_META_SUFFIX)) {
      return content;
    }
    return content.slice(0, markerStart).trimEnd();
  }

  private async estimatePromptTokens(
    messages: Array<{ content: unknown }>,
  ): Promise<number> {
    const promptText = messages
      .map(({ content }) =>
        typeof content === 'string' ? content : JSON.stringify(content),
      )
      .join('\n');
    return (await countTextTokens(promptText)) + messages.length * 4;
  }

  private getMaxInputTokens(): number {
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
      this.llmProvider.getRoutePolicy('structured', activeProvider).fallback,
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
          this.llmProvider.getRoutePolicy('structured', provider).maxTokens,
        );
      }),
    );
    const safetyMargin = Math.max(256, Math.ceil(contextWindow * 0.1));
    return Math.max(1, contextWindow - outputBudget - safetyMargin);
  }

  /**
   * 列出用户所有记忆（用于管理 API）
   */
  async listMemories(userId: string): Promise<Mem0MemoryResult[]> {
    return this.mem0Provider.getAll(userId);
  }

  async listSessionMemories(
    userId: string,
    conversationId: string,
  ): Promise<Mem0MemoryResult[]> {
    return this.mem0Provider.getAll(userId, conversationId);
  }

  async searchMemories(
    query: string,
    userId: string,
    conversationId?: string,
    topK = 5,
  ): Promise<MemorySearchResult> {
    return this.searchMemory(query, userId, conversationId, topK);
  }

  /**
   * 清空用户所有记忆（用于管理 API）
   */
  async clearMemories(userId: string): Promise<void> {
    await this.mem0Provider.deleteAll(userId);
  }

  /**
   * 删除指定会话的临时记忆，不影响用户跨会话保留的长期记忆。
   */
  async deleteSessionMemory(
    userId: string | null | undefined,
    conversationId: string,
  ): Promise<void> {
    if (!this.mem0Provider.isRequested()) return;
    if (!this.mem0Provider.isEnabled()) {
      throw new Error('Mem0 is enabled but unavailable.');
    }
    if (!userId?.trim() || !conversationId.trim()) {
      throw new Error(
        'Session memory cleanup requires userId and conversationId.',
      );
    }

    await this.mem0Provider.deleteByRunId(userId, conversationId);
  }
}
