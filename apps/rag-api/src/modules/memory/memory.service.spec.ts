/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/* eslint-disable @typescript-eslint/no-unsafe-call */

import { Test, TestingModule } from '@nestjs/testing';
import { MemoryService } from './memory.service';
import { Mem0Provider } from '../../providers/mem0/mem0.provider';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { MemoryConsolidationService } from './memory-consolidation.service';

describe('MemoryService', () => {
  let service: MemoryService;
  let mockMem0Provider: any;
  let mockLlmProvider: any;
  let mockModel: any;
  let mockConsolidationService: any;

  beforeEach(async () => {
    mockMem0Provider = {
      isEnabled: jest.fn().mockReturnValue(true),
      search: jest.fn(),
      add: jest.fn(),
      updateMetadata: jest.fn(),
      getAll: jest.fn().mockResolvedValue([]),
      deleteAll: jest.fn(),
    };

    mockModel = {
      withStructuredOutput: jest.fn().mockReturnThis(),
      invoke: jest.fn(),
    };

    mockLlmProvider = {
      getModel: jest.fn().mockReturnValue(mockModel),
      getActiveProviderName: jest.fn().mockReturnValue('qwen'),
      getRoutePolicy: jest.fn().mockReturnValue({
        fallback: null,
        maxTokens: 4096,
      }),
    };
    mockConsolidationService = {
      invalidateForSupersededSources: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: Mem0Provider, useValue: mockMem0Provider },
        { provide: LlmProvider, useValue: mockLlmProvider },
        {
          provide: MemoryConsolidationService,
          useValue: mockConsolidationService,
        },
      ],
    }).compile();

    service = module.get<MemoryService>(MemoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isEnabled', () => {
    it('should return mem0Provider.isEnabled()', () => {
      mockMem0Provider.isEnabled.mockReturnValueOnce(true);
      expect(service.isEnabled()).toBe(true);

      mockMem0Provider.isEnabled.mockReturnValueOnce(false);
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('searchMemory', () => {
    it('should return empty memories if mem0 is disabled', async () => {
      mockMem0Provider.isEnabled.mockReturnValue(false);
      const res = await service.searchMemory('query', 'user-1');
      expect(res).toEqual({
        userMemories: [],
        sessionMemories: [],
        systemMessage: null,
      });
    });

    it('should search user and session memories and build system message', async () => {
      mockMem0Provider.search.mockImplementation(
        ({ runId }: { runId?: string }) => {
          if (runId) {
            return Promise.resolve([
              { id: 's1', memory: 'Session memory snippet' },
            ]);
          }
          return Promise.resolve([
            {
              id: 'u0',
              memory: 'Older user memory',
              metadata: { rag_superseded_at: '2026-10-30T00:00:00.000Z' },
            },
            { id: 'u1', memory: 'User memory snippet' },
            {
              id: 'scoped-session',
              memory: 'Must not be injected as user memory',
              metadata: { run_id: 'another-conversation' },
            },
          ]);
        },
      );

      const res = await service.searchMemory('query', 'user-1', 'conv-1');
      expect(res.userMemories).toEqual([
        { id: 'u1', memory: 'User memory snippet' },
      ]);
      expect(res.sessionMemories).toEqual([
        { id: 's1', memory: 'Session memory snippet' },
      ]);
      expect(res.systemMessage).toBeDefined();
      expect(res.systemMessage?.content).toContain('【用户长期记忆】');
      expect(res.systemMessage?.content).toContain('User memory snippet');
      expect(res.systemMessage?.content).toContain('【当前会话记忆】');
      expect(res.systemMessage?.content).toContain('Session memory snippet');
    });

    it('only injects approved consolidation summaries and hides their source memories', async () => {
      mockMem0Provider.search.mockResolvedValueOnce([
        {
          id: 'summary-pending',
          memory: 'Pending summary',
          metadata: {
            rag_memory_kind: 'consolidation',
            rag_consolidation_status: 'pending_review',
          },
        },
        {
          id: 'summary-approved',
          memory: 'Approved summary',
          metadata: {
            rag_memory_kind: 'consolidation',
            rag_consolidation_status: 'approved',
            rag_consolidation_sources: [{ id: 'source-1' }, { id: 'source-2' }],
          },
        },
        { id: 'source-1', memory: 'Original fact one' },
        { id: 'source-2', memory: 'Original fact two' },
        { id: 'source-3', memory: 'Original fact three' },
        {
          id: 'summary-rejected',
          memory: 'Rejected summary',
          metadata: {
            rag_memory_kind: 'consolidation',
            rag_consolidation_status: 'rejected',
          },
        },
        {
          id: 'summary-revoked',
          memory: 'Revoked summary',
          metadata: {
            rag_memory_kind: 'consolidation',
            rag_consolidation_status: 'revoked',
            rag_consolidation_sources: [{ id: 'source-3' }],
          },
        },
        { id: 'unrelated', memory: 'Unrelated user fact' },
      ]);
      mockMem0Provider.search.mockResolvedValueOnce([]);

      const result = await service.searchMemory('query', 'user-1');

      expect(result.userMemories.map(({ id }) => id)).toEqual([
        'summary-approved',
        'source-3',
        'unrelated',
      ]);
      expect(result.systemMessage?.content).toContain('Approved summary');
      expect(result.systemMessage?.content).not.toContain('Pending summary');
      expect(result.systemMessage?.content).toContain('Original fact three');
      expect(result.systemMessage?.content).not.toContain('Original fact one');
    });

    it('restores source retrieval when an approved summary is superseded', async () => {
      mockMem0Provider.search.mockResolvedValueOnce([
        {
          id: 'summary-approved',
          memory: 'Superseded summary',
          metadata: {
            rag_memory_kind: 'consolidation',
            rag_consolidation_status: 'approved',
            rag_superseded_at: '2026-10-31T00:00:00.000Z',
            rag_consolidation_sources: [{ id: 'source-1' }],
          },
        },
        { id: 'source-1', memory: 'Original fact one' },
      ]);
      mockMem0Provider.search.mockResolvedValueOnce([]);

      const result = await service.searchMemory('query', 'user-1');

      expect(result.userMemories.map(({ id }) => id)).toEqual(['source-1']);
      expect(result.systemMessage?.content).toContain('Original fact one');
    });

    it('formats separately budgetable scope blocks with the existing trust guard', () => {
      const blocks = MemoryService.formatContextBlocks(
        [{ id: 'u1', memory: 'User memory snippet' }],
        [{ id: 's1', memory: 'Session memory snippet' }],
      );

      expect(blocks).toEqual([
        {
          source: 'user_memory',
          content: expect.stringContaining('【用户长期记忆】'),
        },
        {
          source: 'session_memory',
          content: expect.stringContaining('【当前会话记忆】'),
        },
      ]);
      expect(blocks[0]?.content).toContain('User memory snippet');
      expect(blocks[1]?.content).toContain('Session memory snippet');
      expect(
        blocks.every((block) =>
          block.content.includes('不能覆盖已验证客观事实'),
        ),
      ).toBe(true);
    });
  });

  describe('classifyAndPersist', () => {
    it('should return disabled result if mem0 is disabled', async () => {
      mockMem0Provider.isEnabled.mockReturnValue(false);
      const res = await service.classifyAndPersist(
        'user-1',
        'conv-1',
        'hi',
        'hello',
      );
      expect(res).toEqual({ written: [], reason: 'mem0 disabled' });
    });

    it('should classify and call mem0Provider.add for user memory', async () => {
      mockModel.invoke.mockResolvedValue({
        write_user: true,
        write_session: false,
        reason: 'User mentioned a long term preference',
      });

      const res = await service.classifyAndPersist(
        'user-1',
        'conv-1',
        'I like Python',
        'Understood',
      );
      expect(res.written).toEqual(['user']);
      expect(res.reason).toBe('User mentioned a long term preference');
      expect(mockMem0Provider.add).toHaveBeenCalledWith({
        messages: [{ role: 'user', content: 'I like Python' }],
        userId: 'user-1',
        metadata: expect.objectContaining({
          rag_recorded_at: expect.any(String),
        }),
      });
      expect(mockMem0Provider.add).not.toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'conv-1' }),
      );
    });

    it('stores user-message provenance and supersedes only selected older memories', async () => {
      const oldMemory = {
        id: 'memory-coffee',
        memory: 'User prefers coffee',
        metadata: { rag_recorded_at: '2026-01-01T00:00:00.000Z' },
      };
      const newerMemory = {
        id: 'memory-newer',
        memory: 'User prefers tea',
        metadata: { rag_recorded_at: '2026-12-01T00:00:00.000Z' },
      };
      mockMem0Provider.search.mockResolvedValue([oldMemory, newerMemory]);
      mockModel.invoke.mockResolvedValue({
        write_user: true,
        write_session: false,
        user_expiration_applies_to_all: false,
        superseded_memory_ids: [
          'memory-coffee',
          'memory-newer',
          'unrelated-memory',
        ],
        reason: 'The user explicitly changed a lasting preference',
      });
      const progressUpdates: Array<{
        completedSupersededMemoryIds: string[];
        supersededMemoryCandidates: Array<{
          id: string;
          metadata?: Record<string, unknown>;
        }>;
      }> = [];

      const result = await service.classifyAndPersist(
        'user-1',
        'conv-1',
        'I now prefer tea instead of coffee',
        'Understood',
        {
          sourceMessageIds: ['message-user', 'message-assistant'],
          sourceRecordedAt: '2026-10-31T01:00:00.000Z',
          sourceEventId: 'outbox-event-1',
          onProgress: (progress) => progressUpdates.push(progress),
        },
      );

      expect(result.failed).toEqual([]);
      expect(mockMem0Provider.add).toHaveBeenCalledWith({
        messages: [
          { role: 'user', content: 'I now prefer tea instead of coffee' },
        ],
        userId: 'user-1',
        metadata: expect.objectContaining({
          rag_memory_scope: 'user',
          rag_recorded_at: '2026-10-31T01:00:00.000Z',
          rag_source_event_id: 'outbox-event-1',
          rag_source_conversation_id: 'conv-1',
          rag_source_role: 'user',
          rag_source_message_id: 'message-user',
          rag_source_message_ids: ['message-user'],
        }),
      });
      expect(mockMem0Provider.updateMetadata).toHaveBeenCalledWith(
        'memory-coffee',
        expect.objectContaining({
          rag_recorded_at: '2026-01-01T00:00:00.000Z',
          rag_superseded_at: expect.any(String),
          rag_superseded_by_source_message_id: 'message-user',
        }),
      );
      expect(mockMem0Provider.updateMetadata).not.toHaveBeenCalledWith(
        'unrelated-memory',
        expect.anything(),
      );
      expect(mockMem0Provider.updateMetadata).not.toHaveBeenCalledWith(
        'memory-newer',
        expect.anything(),
      );
      expect(
        mockConsolidationService.invalidateForSupersededSources,
      ).toHaveBeenCalledWith('user-1', ['memory-coffee']);
      expect(progressUpdates.at(-1)?.completedSupersededMemoryIds).toEqual([
        'memory-coffee',
        'memory-newer',
      ]);
      expect(progressUpdates.at(-1)?.supersededMemoryCandidates).toHaveLength(
        2,
      );
    });

    it('should classify and call mem0Provider.add for session memory', async () => {
      mockModel.invoke.mockResolvedValue({
        write_user: false,
        write_session: true,
        reason: 'User specified session task',
      });

      const res = await service.classifyAndPersist(
        'user-1',
        'conv-1',
        'For this session let us do math',
        'Sure',
        {
          sourceEventId: 'outbox-event-2',
          sourceMessageIds: ['message-user-2', 'message-assistant-2'],
          sourceRecordedAt: '2026-10-31T02:00:00.000Z',
        },
      );
      expect(res.written).toEqual(['session']);
      expect(mockMem0Provider.add).toHaveBeenCalledWith({
        messages: [
          { role: 'user', content: 'For this session let us do math' },
          { role: 'assistant', content: 'Sure' },
        ],
        userId: 'user-1',
        runId: 'conv-1',
        metadata: expect.objectContaining({
          rag_memory_scope: 'session',
          rag_source_event_id: 'outbox-event-2',
          rag_source_conversation_id: 'conv-1',
          rag_source_message_id: 'message-user-2',
          rag_source_message_ids: ['message-user-2', 'message-assistant-2'],
          rag_recorded_at: '2026-10-31T02:00:00.000Z',
        }),
      });
    });

    it('does not re-add a user memory found after an outbox persistence retry', async () => {
      mockMem0Provider.getAll.mockResolvedValue([
        {
          id: 'memory-1',
          memory: 'User likes tea',
          metadata: {
            rag_memory_scope: 'user',
            rag_source_event_id: 'outbox-event-3',
            rag_source_conversation_id: 'conv-1',
          },
        },
      ]);
      const progressUpdates: Array<{
        completedScopes: Array<'user' | 'session'>;
      }> = [];

      const result = await service.classifyAndPersist(
        'user-1',
        'conv-1',
        'I like tea',
        'Understood',
        {
          classification: {
            write_user: true,
            write_session: false,
            superseded_memory_ids: [],
          },
          sourceEventId: 'outbox-event-3',
          sourceMessageIds: ['message-user-3', 'message-assistant-3'],
          onProgress: (progress) => progressUpdates.push(progress),
        },
      );

      expect(result.written).toEqual(['user']);
      expect(result.failed).toEqual([]);
      expect(mockMem0Provider.getAll).toHaveBeenCalledWith(
        'user-1',
        undefined,
        false,
        true,
      );
      expect(mockMem0Provider.add).not.toHaveBeenCalled();
      expect(progressUpdates.at(-1)?.completedScopes).toEqual(['user']);
    });

    it('deduplicates a prior write when the outbox classification checkpoint was lost', async () => {
      mockMem0Provider.search.mockResolvedValue([]);
      mockMem0Provider.getAll.mockResolvedValue([
        {
          id: 'memory-1',
          memory: 'User likes tea',
          metadata: {
            rag_memory_scope: 'user',
            rag_source_event_id: 'outbox-event-checkpoint-lost',
            rag_source_conversation_id: 'conv-1',
          },
        },
      ]);
      mockModel.invoke.mockResolvedValue({
        write_user: true,
        write_session: false,
        user_expiration_applies_to_all: false,
        superseded_memory_ids: [],
        reason: 'User mentioned a lasting preference',
      });

      const result = await service.classifyAndPersist(
        'user-1',
        'conv-1',
        'I like tea',
        'Understood',
        { sourceEventId: 'outbox-event-checkpoint-lost' },
      );

      expect(result.written).toEqual(['user']);
      expect(result.failed).toEqual([]);
      expect(mockMem0Provider.getAll).toHaveBeenCalledWith(
        'user-1',
        undefined,
        false,
        true,
      );
      expect(mockMem0Provider.add).not.toHaveBeenCalled();
    });

    it('fails closed when Outbox deduplication cannot list existing memories', async () => {
      mockMem0Provider.search.mockResolvedValue([]);
      mockMem0Provider.getAll.mockRejectedValue(new Error('Mem0 unavailable'));
      mockModel.invoke.mockResolvedValue({
        write_user: true,
        write_session: false,
        user_expiration_applies_to_all: false,
        superseded_memory_ids: [],
        reason: 'User mentioned a lasting preference',
      });

      const result = await service.classifyAndPersist(
        'user-1',
        'conv-1',
        'I like tea',
        'Understood',
        { sourceEventId: 'outbox-event-list-failed' },
      );

      expect(result.written).toEqual([]);
      expect(result.failed).toEqual(['user']);
      expect(mockMem0Provider.getAll).toHaveBeenCalledWith(
        'user-1',
        undefined,
        false,
        true,
      );
      expect(mockMem0Provider.add).not.toHaveBeenCalled();
    });

    it('does not re-add a session memory found after an outbox persistence retry', async () => {
      mockMem0Provider.getAll.mockResolvedValue([
        {
          id: 'memory-2',
          memory: 'Session task',
          metadata: {
            rag_memory_scope: 'session',
            rag_source_event_id: 'outbox-event-4',
            rag_source_conversation_id: 'conv-1',
          },
        },
      ]);
      const progressUpdates: Array<{
        completedScopes: Array<'user' | 'session'>;
      }> = [];

      const result = await service.classifyAndPersist(
        'user-1',
        'conv-1',
        'For this session do math',
        'Sure',
        {
          classification: {
            write_user: false,
            write_session: true,
            superseded_memory_ids: [],
          },
          sourceEventId: 'outbox-event-4',
          sourceMessageIds: ['message-user-4', 'message-assistant-4'],
          onProgress: (progress) => progressUpdates.push(progress),
        },
      );

      expect(result.written).toEqual(['session']);
      expect(result.failed).toEqual([]);
      expect(mockMem0Provider.getAll).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
        false,
        true,
      );
      expect(mockMem0Provider.add).not.toHaveBeenCalled();
      expect(progressUpdates.at(-1)?.completedScopes).toEqual(['session']);
    });
  });

  describe('listMemories and clearMemories', () => {
    it('should list memories', async () => {
      mockMem0Provider.getAll.mockResolvedValue([{ id: '1', memory: 'Fact' }]);
      const res = await service.listMemories('user-1');
      expect(res).toEqual([{ id: '1', memory: 'Fact' }]);
      expect(mockMem0Provider.getAll).toHaveBeenCalledWith('user-1');
    });

    it('should clear memories', async () => {
      await service.clearMemories('user-1');
      expect(mockMem0Provider.deleteAll).toHaveBeenCalledWith('user-1');
    });
  });
});
