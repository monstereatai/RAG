/* eslint-disable @typescript-eslint/unbound-method */
/**
 * Chat Modes Integration Test
 *
 * Tests the routing logic and service integration for the three chat modes (simple, agentic, auto).
 * Uses mocked dependencies to isolate NestJS service interaction.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from '../modules/chat/chat.service';
import { KarpathyRagService } from '../rag/karpathy/karpathy-rag.service';
import { AgenticRagService } from '../rag/agentic/agentic-rag.service';
import { ConversationService } from '../modules/chat/conversation.service';
import { ConversationEmbeddingService } from '../modules/chat/conversation-embedding.service';
import { MemoryService } from '../modules/memory/memory.service';
import { BadRequestException } from '@nestjs/common';

describe('ChatModes Integration', () => {
  let chatService: ChatService;
  let karpathyRagService: jest.Mocked<KarpathyRagService>;
  let agenticRagService: jest.Mocked<AgenticRagService>;
  let conversationService: jest.Mocked<ConversationService>;
  let conversationEmbeddingService: jest.Mocked<ConversationEmbeddingService>;

  beforeEach(async () => {
    const mockKarpathyRagService = {
      answer: jest.fn(),
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
      undefined,
      [],
      'new-thread-123',
      'user-1',
      expect.any(Array),
    );
    expect(karpathyRagService.answer).not.toHaveBeenCalled();
    expect(res.answer).toBe('Quantum computing is...');
    expect(res.mode).toBe('agentic');
    expect(res.route).toBe('agentic');
    expect(res.confidence).toBe(0.95);
  });

  it('should handle history context when matching historical conversations found', async () => {
    const query = 'Show status';
    conversationEmbeddingService.searchHistory.mockResolvedValue([
      { id: 'h1', text: 'status ok', metadata: {} } as any,
    ]);
    karpathyRagService.answer.mockResolvedValue({
      answer: 'Status is OK',
      references: [],
    });

    await chatService.chat({ query, mode: 'simple' }, 'user-1');

    expect(conversationEmbeddingService.searchHistory).toHaveBeenCalledWith(
      query,
      2,
      'user-1',
    );
    expect(
      conversationEmbeddingService.formatHistoryContext,
    ).toHaveBeenCalled();
  });
});
