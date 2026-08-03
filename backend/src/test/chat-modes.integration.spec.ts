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
import { KarpathyRagService } from '../rag/karpathy/karpathy-rag.service';
import { AgenticRagService } from '../rag/agentic/agentic-rag.service';
import { ConversationService } from '../modules/chat/conversation.service';
import { ConversationEmbeddingService } from '../modules/chat/conversation-embedding.service';
import { MemoryService } from '../modules/memory/memory.service';
import { QueryLogEntity } from '../providers/db/entities/query-log.entity';
import { BadRequestException } from '@nestjs/common';
import { ShortTermMemoryService } from '../modules/memory/short-term-memory.service';
import { LangfuseProvider } from '../providers/observability/langfuse.provider';

describe('ChatModes Integration', () => {
  let chatService: ChatService;
  let karpathyRagService: jest.Mocked<KarpathyRagService>;
  let agenticRagService: jest.Mocked<AgenticRagService>;
  let conversationService: jest.Mocked<ConversationService>;
  let conversationEmbeddingService: jest.Mocked<ConversationEmbeddingService>;

  beforeEach(async () => {
    const mockKarpathyRagService = {
      answer: jest.fn(),
      unsupportedReliableAnswer: jest
        .fn()
        .mockReturnValue('知识库片段不足以支撑可靠回答，暂不生成确定结论。'),
    };
    const mockAgenticRagService = {
      run: jest.fn(),
    };
    const mockConversationService = {
      create: jest.fn().mockResolvedValue('new-thread-123'),
      getRecentHistory: jest.fn().mockResolvedValue([]),
      addMessage: jest.fn().mockResolvedValue(undefined),
    };
    const mockConversationEmbeddingService = {
      searchHistory: jest.fn().mockResolvedValue([]),
      formatHistoryContext: jest.fn().mockReturnValue('Formatted history'),
      indexConversation: jest.fn().mockResolvedValue(undefined),
    };
    const mockMemoryService = {
      searchMemory: jest.fn().mockResolvedValue({
        systemMessage: { content: 'mock memory' },
        userMemories: [],
        sessionMemories: [],
      }),
      classifyAndPersist: jest.fn().mockResolvedValue(undefined),
    };

    const mockQueryLogRepo = {
      save: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockImplementation((data: unknown) => data),
    };
    const mockShortTermMemory = {
      getContext: jest.fn().mockResolvedValue({
        systemMessage: null,
        recentTurns: [],
        truncatedHistory: false,
      }),
      addTurn: jest.fn().mockResolvedValue(undefined),
    };
    const mockLangfuseProvider = {
      estimateTextTokens: jest.fn().mockReturnValue(1),
      estimateCostUsd: jest.fn().mockReturnValue(0),
      traceRagAnswer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: KarpathyRagService, useValue: mockKarpathyRagService },
        { provide: AgenticRagService, useValue: mockAgenticRagService },
        { provide: ConversationService, useValue: mockConversationService },
        {
          provide: ConversationEmbeddingService,
          useValue: mockConversationEmbeddingService,
        },
        { provide: MemoryService, useValue: mockMemoryService },
        { provide: ShortTermMemoryService, useValue: mockShortTermMemory },
        { provide: LangfuseProvider, useValue: mockLangfuseProvider },
        {
          provide: getRepositoryToken(QueryLogEntity),
          useValue: mockQueryLogRepo,
        },
      ],
    }).compile();

    chatService = module.get<ChatService>(ChatService);
    karpathyRagService = module.get(KarpathyRagService);
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

  it('should route simple mode to KarpathyRagService', async () => {
    const query = 'Who are you?';
    const mockResponse = {
      answer: 'I am simple RAG',
      references: [],
    };
    karpathyRagService.answer.mockResolvedValue(mockResponse);

    const res = await chatService.chat({ query, mode: 'simple' }, 'user-1');

    expect(karpathyRagService.answer).toHaveBeenCalledWith(
      query,
      [],
      'user-1',
      expect.any(Array),
      undefined,
      { scope: { role: undefined } },
    );
    expect(agenticRagService.run).not.toHaveBeenCalled();
    expect(res.answer).toBe('I am simple RAG');
    expect(res.mode).toBe('simple');
    expect(res.route).toBe('simple');
    expect(res.threadId).toBe('new-thread-123');

    // Verify conversation persists
    expect(conversationService.addMessage).toHaveBeenCalledWith(
      'new-thread-123',
      'human',
      query,
      'user-1',
    );
    expect(conversationService.addMessage).toHaveBeenCalledWith(
      'new-thread-123',
      'ai',
      'I am simple RAG',
      'user-1',
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
      { scope: { role: undefined } },
    );
    expect(karpathyRagService.answer).not.toHaveBeenCalled();
    expect(res.answer).toBe('Quantum computing is...');
    expect(res.mode).toBe('agentic');
    expect(res.route).toBe('agentic');
    expect(res.confidence).toBe(0.95);
  });

  it('should handle history context when matching historical conversations found', async () => {
    const query = 'Show status';
    const threadId = '11111111-1111-4111-8111-111111111111';
    conversationEmbeddingService.searchHistory.mockResolvedValue([
      { id: 'h1', text: 'status ok', metadata: {} } as any,
    ]);
    karpathyRagService.answer.mockResolvedValue({
      answer: 'Status is OK',
      references: [],
    });

    await chatService.chat({ query, mode: 'simple', threadId }, 'user-1');

    expect(conversationEmbeddingService.searchHistory).toHaveBeenCalledWith(
      query,
      2,
      'user-1',
    );
    expect(
      conversationEmbeddingService.formatHistoryContext,
    ).toHaveBeenCalled();
  });

  it('should apply the selected role to retrieval and answer context', async () => {
    karpathyRagService.answer.mockResolvedValue({
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

    const call = karpathyRagService.answer.mock.calls[0];
    expect(call?.[0]).toBe('检查需求缺口');
    expect(
      call?.[3].some((message) =>
        message.content.includes('当前服务对象岗位：产品经理'),
      ),
    ).toBe(true);
    expect(call?.[5]).toEqual({ scope: { role: 'product-manager' } });
  });
});
