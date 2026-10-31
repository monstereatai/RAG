/* eslint-disable @typescript-eslint/unbound-method */
/**
 * Unified chat pipeline integration test.
 *
 * The legacy simple/auto/agentic request values are retained for API
 * compatibility, but ChatService must always enter one intent-routed pipeline.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChatService } from '../modules/chat/chat.service';
import {
  RAG_QUERY_CAPABILITY,
  type RagQueryCapability,
} from '../rag/contracts/rag-capabilities';
import { AgenticRagService } from '../rag/agentic/agentic-rag.service';
import { ConversationService } from '../modules/chat/conversation.service';
import { ConversationEmbeddingService } from '../modules/chat/conversation-embedding.service';
import { MemoryService } from '../modules/memory/memory.service';
import { QueryLogEntity } from '../providers/db/entities/query-log.entity';
import { BadRequestException } from '@nestjs/common';
import { ShortTermMemoryService } from '../modules/memory/short-term-memory.service';
import { LangfuseProvider } from '../providers/observability/langfuse.provider';
import { QueryPlannerService } from '../rag/planning/query-planner.service';
import { RetrievalPolicyService } from '../rag/planning/retrieval-policy.service';
import { ChatQueryLogService } from '../modules/chat/chat-query-log.service';

describe('Unified chat pipeline', () => {
  let chatService: ChatService;
  let ragService: jest.Mocked<RagQueryCapability>;
  let agenticRagService: jest.Mocked<AgenticRagService>;
  let conversationService: jest.Mocked<ConversationService>;
  let conversationEmbeddingService: jest.Mocked<ConversationEmbeddingService>;

  const basePlan = {
    action: 'retrieve',
    domain: 'internal',
    contextMode: 'independent',
    standaloneQuery: '',
    subQueries: [],
    taskType: 'lookup',
    needsGraph: false,
    entities: [],
    filters: {},
  } as const;

  beforeEach(async () => {
    const mockRagService = {
      answer: jest.fn(),
      unsupportedReliableAnswer: jest
        .fn()
        .mockReturnValue('知识库片段不足以支撑可靠回答，暂不生成确定结论。'),
    };
    const mockAgenticRagService = {
      run: jest.fn(),
    };
    const mockConversationService = {
      assertAccessible: jest.fn().mockResolvedValue(true),
      create: jest.fn().mockResolvedValue('new-thread-123'),
      getRecentHistory: jest.fn().mockResolvedValue([]),
      addMessage: jest.fn().mockResolvedValue(undefined),
      addCompletedTurn: jest.fn().mockResolvedValue({
        userMessageId: 'user-message-1',
        assistantMessageId: 'assistant-message-1',
      }),
    };
    const mockConversationEmbeddingService = {
      searchHistory: jest.fn().mockResolvedValue([]),
      formatHistoryContext: jest.fn().mockReturnValue('Formatted history'),
      indexConversation: jest.fn().mockResolvedValue(undefined),
    };
    const mockMemoryService = {
      isEnabled: jest.fn().mockReturnValue(false),
      searchMemory: jest.fn().mockResolvedValue({
        systemMessage: { content: 'mock memory' },
        userMemories: [],
        sessionMemories: [],
      }),
      classifyAndPersist: jest.fn().mockResolvedValue(undefined),
    };
    const mockChatQueryLogService = {
      logQuery: jest.fn().mockResolvedValue(undefined),
    };
    const mockQueryLogRepo = {
      save: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockImplementation((data: unknown) => data),
    };
    const contextBudgeter = Object.create(
      ShortTermMemoryService.prototype,
    ) as ShortTermMemoryService;
    const mockShortTermMemory = {
      budgetSystemContext:
        contextBudgeter.budgetSystemContext.bind(contextBudgeter),
      getMessageSafetyCap:
        contextBudgeter.getMessageSafetyCap.bind(contextBudgeter),
      getContext: jest.fn().mockResolvedValue({
        systemMessage: null,
        recentTurns: [],
        truncatedHistory: false,
      }),
      addTurn: jest.fn().mockResolvedValue(undefined),
      addTurns: jest.fn().mockResolvedValue(null),
      getAvailableHistoryTokenBudget: jest.fn().mockReturnValue(8_000),
      limitHistoryToTokenBudget: jest.fn(
        <T extends { content: string; role?: string }>(turns: T[]) => turns,
      ),
    };
    const mockLangfuseProvider = {
      estimateTextTokens: jest.fn().mockReturnValue(1),
      estimateCostUsd: jest.fn().mockReturnValue(0),
      traceRagAnswer: jest.fn(),
    };
    const mockQueryPlanner = {
      plan: jest.fn().mockResolvedValue(basePlan),
    };
    const mockRetrievalPolicy = {
      build: jest.fn().mockReturnValue({
        planVersion: 2,
        sourcePolicy: 'local_only',
        queries: [{ text: 'query', kind: 'original', weight: 1 }],
        profile: {
          intent: 'lookup',
          candidateDepth: 8,
          finalTopK: 4,
          neighborWindow: 0,
          sameSectionLimit: 0,
          contextCharacterBudget: 3500,
          maxChunksPerDocument: 2,
        },
        useGraph: false,
        reasonCode: 'internal_evidence_required',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: RAG_QUERY_CAPABILITY, useValue: mockRagService },
        { provide: AgenticRagService, useValue: mockAgenticRagService },
        { provide: ConversationService, useValue: mockConversationService },
        {
          provide: ConversationEmbeddingService,
          useValue: mockConversationEmbeddingService,
        },
        { provide: MemoryService, useValue: mockMemoryService },
        { provide: ShortTermMemoryService, useValue: mockShortTermMemory },
        { provide: LangfuseProvider, useValue: mockLangfuseProvider },
        { provide: ChatQueryLogService, useValue: mockChatQueryLogService },
        {
          provide: getRepositoryToken(QueryLogEntity),
          useValue: mockQueryLogRepo,
        },
        { provide: QueryPlannerService, useValue: mockQueryPlanner },
        { provide: RetrievalPolicyService, useValue: mockRetrievalPolicy },
      ],
    }).compile();

    chatService = module.get<ChatService>(ChatService);
    ragService = module.get(RAG_QUERY_CAPABILITY);
    agenticRagService = module.get(AgenticRagService);
    conversationService = module.get(ConversationService);
    conversationEmbeddingService = module.get(ConversationEmbeddingService);
  });

  it('rejects empty queries', async () => {
    await expect(chatService.chat({ query: '' }, 'user-1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(chatService.chat({ query: '   ' }, 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('normalizes every legacy mode into one auto-routed pipeline', async () => {
    agenticRagService.run.mockResolvedValue({
      answer: '统一链路回答',
      references: [],
      route: 'simple',
      confidence: 1,
      retryCount: 0,
      retrievalSufficient: true,
      retrievalReason: '意图路由选择快速路径',
    });

    for (const mode of ['simple', 'auto', 'agentic'] as const) {
      const response = await chatService.chat(
        { query: `统一链路-${mode}`, mode },
        'user-1',
      );
      expect(response.mode).toBe('auto');
      expect(response.route).toBe('simple');
    }

    expect(agenticRagService.run).toHaveBeenCalledTimes(3);
    for (const call of agenticRagService.run.mock.calls) {
      expect(call[1]).toBe('auto');
    }
    expect(ragService.answer).not.toHaveBeenCalled();
    expect(conversationService.addCompletedTurn).toHaveBeenCalledTimes(3);
  });

  it('preserves the internal deep route and evidence contract', async () => {
    const reference = {
      id: 'chunk-1',
      docId: 'doc-1',
      chunkIndex: 0,
      content: '内部流程证据',
      score: 0.91,
      totalScore: 0.91,
      bm25Score: 0.91,
      cosineScore: 0,
    };
    agenticRagService.run.mockResolvedValue({
      answer: '深度分析回答。[片段1]',
      references: [reference],
      route: 'agentic',
      confidence: 0.95,
      retryCount: 1,
      retrievalSufficient: true,
      retrievalReason: '多子问题证据充分',
    });

    const result = await chatService.chat(
      { query: '复杂对比问题', mode: 'simple' },
      'user-1',
    );

    expect(result.mode).toBe('auto');
    expect(result.route).toBe('agentic');
    expect(result.references).toEqual([reference]);
    expect(result.retrievalSufficient).toBe(true);
    const call = agenticRagService.run.mock.calls.at(-1);
    expect(call?.[0]).toBe('复杂对比问题');
    expect(call?.[1]).toBe('auto');
    expect(call?.[3]).toEqual([]);
    expect(call?.[4]).toBe('new-thread-123');
    expect(call?.[5]).toBe('user-1');
    expect(call?.[7]).toBe(false);
    expect(call?.[8].scope).toEqual({ role: undefined });
    expect(call?.[9].signal).toBeInstanceOf(AbortSignal);
  });

  it('forwards history context and the selected role to the unified pipeline', async () => {
    const query = '检查需求缺口';
    const threadId = '11111111-1111-4111-8111-111111111111';
    conversationEmbeddingService.searchHistory.mockResolvedValue([
      { content: 'Q: 之前的需求\nA: 已有结论', threadId, score: 0.9 },
    ]);
    agenticRagService.run.mockResolvedValue({
      answer: '已按产品经理视角整理',
      references: [],
      route: 'simple',
      confidence: 1,
      retryCount: 0,
      retrievalSufficient: true,
    });

    await chatService.chat(
      {
        query,
        mode: 'simple',
        rolePresetId: 'product-manager',
        threadId,
      },
      'user-1',
    );

    expect(conversationEmbeddingService.searchHistory).toHaveBeenCalledWith(
      query,
      2,
      'user-1',
      undefined,
    );
    const call = agenticRagService.run.mock.calls.at(-1);
    expect(
      call?.[6].some((message) => message.content.includes('相关历史对话')),
    ).toBe(true);
    expect(
      call?.[6].some((message) =>
        message.content.includes('当前服务对象岗位：产品经理'),
      ),
    ).toBe(true);
    expect(call?.[8]).toEqual(
      expect.objectContaining({
        scope: { role: 'product-manager' },
      }),
    );
  });
});
