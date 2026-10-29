/* eslint-disable @typescript-eslint/unbound-method */
/**
 * Chat Modes Integration Test
 *
 * Tests the routing logic and service integration for the three chat modes (simple, agentic, auto).
 * Uses mocked dependencies to isolate NestJS service interaction.
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

describe('ChatModes Integration', () => {
  let chatService: ChatService;
  let ragService: jest.Mocked<RagQueryCapability>;
  let agenticRagService: jest.Mocked<AgenticRagService>;
  let conversationService: jest.Mocked<ConversationService>;
  let conversationEmbeddingService: jest.Mocked<ConversationEmbeddingService>;

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
      addCompletedTurn: jest.fn().mockResolvedValue({ userMessageId: 'user-message-1', assistantMessageId: 'assistant-message-1' }),
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
    // Use the real pure budgeting method; infrastructure methods remain mocked.
    const contextBudgeter = Object.create(ShortTermMemoryService.prototype) as ShortTermMemoryService;
    const mockShortTermMemory = {
      budgetSystemContext: contextBudgeter.budgetSystemContext.bind(contextBudgeter),
      getMessageSafetyCap: contextBudgeter.getMessageSafetyCap.bind(contextBudgeter),
      getContext: jest.fn().mockResolvedValue({
        systemMessage: null,
        recentTurns: [],
        truncatedHistory: false,
      }),
      addTurn: jest.fn().mockResolvedValue(undefined),
      addTurns: jest.fn().mockResolvedValue(null),
      getAvailableHistoryTokenBudget: jest.fn().mockReturnValue(8_000),
      limitHistoryToTokenBudget: jest.fn((turns) => turns),
    };
    const mockLangfuseProvider = {
      estimateTextTokens: jest.fn().mockReturnValue(1),
      estimateCostUsd: jest.fn().mockReturnValue(0),
      traceRagAnswer: jest.fn(),
    };
    const mockQueryPlanner = {
      plan: jest.fn().mockResolvedValue({
        action: 'retrieve',
        domain: 'internal',
        contextMode: 'independent',
        standaloneQuery: '',
        subQueries: [],
        taskType: 'lookup',
        needsGraph: false,
        entities: [],
        filters: {},
      }),
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

  it('should throw BadRequestException if query is empty', async () => {
    await expect(chatService.chat({ query: '' }, 'user-1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(chatService.chat({ query: '   ' }, 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should route simple mode through direct answer and unified Hybrid RAG', async () => {
    const query = 'Who are you?';
    const mockResponse = {
      answer: 'I am simple RAG',
      references: [],
    };
    ragService.answer.mockResolvedValue(mockResponse);

    const res = await chatService.chat({ query, mode: 'simple' }, 'user-1');

    expect(ragService.answer).toHaveBeenCalledWith(
      query,
      [],
      'user-1',
      expect.any(Array),
      undefined,
      expect.objectContaining({
        adaptiveVectorSearch: true,
        governedDirectAnswer: true,
        entities: [],
        needsSynthesis: false,
        scope: { role: undefined },
      }),
    );
    expect(agenticRagService.run).not.toHaveBeenCalled();
    expect(res.answer).toBe('I am simple RAG');
    expect(res.mode).toBe('simple');
    expect(res.route).toBe('simple');
    expect(res.threadId).toBe('new-thread-123');

    // Verify conversation persists as one completed turn.
    expect(conversationService.addCompletedTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'new-thread-123',
        query,
        answer: 'I am simple RAG',
        userId: 'user-1',
      }),
    );
  });

  it('should route agentic mode to AgenticRagService', async () => {
    const query = 'Explain quantum computing';
    const mockResponse = {
      answer: 'Quantum computing is...',
      references: [],
      route: 'agentic' as const,
      confidence: 0.95,
      retryCount: 1,
      retrievalSufficient: true,
      retrievalReason: 'found in docs',
    };
    agenticRagService.run.mockResolvedValue(mockResponse);

    const res = await chatService.chat({ query, mode: 'agentic' }, 'user-1');

    expect(agenticRagService.run).toHaveBeenCalledWith(
      query,
      'agentic',
      expect.any(Function),
      [],
      'new-thread-123',
      'user-1',
      expect.any(Array),
      false,
      expect.objectContaining({
        entities: [],
        needsSynthesis: false,
        runtimeRunId: undefined,
        scope: { role: undefined },
      }),
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(ragService.answer).not.toHaveBeenCalled();
    expect(res.answer).toBe('Quantum computing is...');
    expect(res.mode).toBe('agentic');
    expect(res.route).toBe('agentic');
    expect(res.confidence).toBe(0.95);
  });

  it('should route auto mode through AgenticRagService for engine selection', async () => {
    agenticRagService.run.mockResolvedValue({
      answer: 'Auto 选择了 Simple 引擎。',
      references: [],
      route: 'simple',
      confidence: 1,
      retryCount: 0,
      retrievalSufficient: true,
      retrievalReason: '首轮证据充分，单轮回答即可',
    });

    const res = await chatService.chat(
      { query: 'ACT100 的状态是什么？', mode: 'auto' },
      'user-1',
    );

    expect(agenticRagService.run).toHaveBeenCalledWith(
      'ACT100 的状态是什么？',
      'auto',
      expect.any(Function),
      [],
      'new-thread-123',
      'user-1',
      expect.any(Array),
      false,
      expect.objectContaining({ scope: { role: undefined } }),
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(res.mode).toBe('auto');
    expect(res.route).toBe('simple');
  });

  it('preserves the same evidence response contract across simple, auto and agentic', async () => {
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
    for (const mode of ['simple', 'auto', 'agentic'] as const) {
      ragService.answer.mockResolvedValueOnce({
        answer: '已根据证据回答。[片段1]',
        references: [reference],
        retrievalSufficient: true,
        retrievalReason: '统一证据门禁通过',
      });
      agenticRagService.run.mockResolvedValueOnce({
        answer: '已根据证据回答。[片段1]',
        references: [reference],
        route: mode === 'auto' ? 'simple' : 'agentic',
        confidence: 1,
        retryCount: 0,
        retrievalSufficient: true,
        retrievalReason: '统一证据门禁通过',
      });

      const result = await chatService.chat(
        { query: `内部证据测试-${mode}`, mode },
        'user-1',
      );

      expect(result.references).toEqual([reference]);
      expect(result.retrievalSufficient).toBe(true);
      expect(result.answer).toContain('[片段1]');
    }
  });

  it('should handle history context when matching historical conversations found', async () => {
    const query = 'Show status';
    const threadId = '11111111-1111-4111-8111-111111111111';
    conversationEmbeddingService.searchHistory.mockResolvedValue([
      { content: 'Q: Show status\nA: status ok', threadId, score: 0.9 },
    ]);
    ragService.answer.mockResolvedValue({
      answer: 'Status is OK',
      references: [],
    });

    await chatService.chat({ query, mode: 'simple', threadId }, 'user-1');

    expect(conversationEmbeddingService.searchHistory).toHaveBeenCalledWith(
      query,
      2,
      'user-1',
      undefined,
    );
    expect(ragService.answer.mock.calls[0]?.[3]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('相关历史对话') }),
      ]),
    );
  });

  it('should apply the selected role to retrieval and answer context', async () => {
    ragService.answer.mockResolvedValue({
      answer: '已按产品经理视角整理',
      references: [],
    });

    await chatService.chat(
      {
        query: '检查需求缺口',
        mode: 'simple',
        rolePresetId: 'product-manager',
      },
      'user-1',
    );

    const call = ragService.answer.mock.calls[0];
    expect(call?.[0]).toBe('检查需求缺口');
    expect(
      call?.[3]?.some((message) =>
        message.content.includes('当前服务对象岗位：产品经理'),
      ),
    ).toBe(true);
    expect(call?.[5]).toEqual(expect.objectContaining({
      adaptiveVectorSearch: true,
      governedDirectAnswer: true,
      entities: [],
      needsSynthesis: false,
      scope: { role: 'product-manager' },
    }));
  });
});
